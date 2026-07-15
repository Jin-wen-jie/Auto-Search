import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}));

vi.mock("./database", () => ({
  getDatabase: mocks.getDatabase,
}));

import {
  listCandidates,
  normalizeCandidate,
  reviewCandidate,
} from "./candidate-repository.js";

describe("candidate repository listing", () => {
  it("returns only candidates that still need review", async () => {
    let whereCondition: { getSQL(): unknown } | undefined;
    const query = {
      from: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn((condition: { getSQL(): unknown }) => {
        whereCondition = condition;
        return query;
      }),
      orderBy: vi.fn(),
      limit: vi.fn(),
      offset: vi.fn().mockResolvedValue([]),
    };
    query.from.mockReturnValue(query);
    query.leftJoin.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    mocks.getDatabase.mockReturnValue({
      select: vi.fn().mockReturnValue(query),
    });

    await expect(listCandidates()).resolves.toMatchObject({
      items: [],
      total: 0,
    });
    expect(whereCondition).toBeDefined();
    if (!whereCondition) throw new Error("where condition was not captured");
    const sqlQuery = new PgDialect().sqlToQuery(whereCondition.getSQL() as never);
    expect(sqlQuery.params).toEqual(
      expect.arrayContaining(["DISCOVERED", "REVIEW_REQUIRED"]),
    );
    expect(sqlQuery.params).not.toEqual(
      expect.arrayContaining(["APPROVED", "REJECTED"]),
    );
  });
});

function createDatabase({
  status,
}: {
  status: string;
}) {
  const limit = vi
    .fn()
    .mockResolvedValueOnce([{ id: "candidate-1", status }])
    .mockResolvedValueOnce([{ comparisonKey: "spec-key" }]);
  const selectQuery = {
    from: vi.fn(),
    where: vi.fn(),
    limit,
  };
  selectQuery.from.mockReturnValue(selectQuery);
  selectQuery.where.mockReturnValue(selectQuery);

  const returning = vi.fn().mockResolvedValue([{ id: "candidate-1" }]);
  const updateQuery = {
    set: vi.fn(),
    where: vi.fn(),
    returning,
  };
  updateQuery.set.mockReturnValue(updateQuery);
  updateQuery.where.mockImplementation((condition: { getSQL(): unknown }) => {
    const query = new PgDialect().sqlToQuery(condition.getSQL() as never);
    const requiredParams = [
      "candidate-1",
      "DISCOVERED",
      "REVIEW_REQUIRED",
    ];
    const guardsAgainstStatusRace = requiredParams.every((param) =>
      query.params.includes(param),
    );
    returning.mockResolvedValueOnce(
      guardsAgainstStatusRace ? [] : [{ id: "candidate-1" }],
    );
    return updateQuery;
  });

  const auditValues = vi.fn().mockResolvedValue(undefined);
  const tx = {
    select: vi.fn().mockReturnValue(selectQuery),
    update: vi.fn().mockReturnValue(updateQuery),
    insert: vi.fn().mockReturnValue({ values: auditValues }),
  };
  const transaction = vi.fn(
    async (callback: (transaction: typeof tx) => unknown) => callback(tx),
  );

  return {
    db: { transaction },
    auditValues,
    insert: tx.insert,
    returning,
    update: tx.update,
  };
}

describe("candidate repository normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["APPROVED", "REJECTED"])(
    "does not mutate or audit a %s candidate",
    async (status) => {
      const database = createDatabase({ status });
      mocks.getDatabase.mockReturnValue(database.db);

      await expect(
        normalizeCandidate("candidate-1", "spec-1"),
      ).resolves.toEqual({ ok: false, reason: "INVALID_STATUS" });
      expect(database.update).not.toHaveBeenCalled();
      expect(database.insert).not.toHaveBeenCalled();
      expect(database.auditValues).not.toHaveBeenCalled();
    },
  );

  it("does not audit when an allowed candidate changes status before update", async () => {
    const database = createDatabase({
      status: "REVIEW_REQUIRED",
    });
    mocks.getDatabase.mockReturnValue(database.db);

    await expect(
      normalizeCandidate("candidate-1", "spec-1"),
    ).resolves.toEqual({ ok: false, reason: "INVALID_STATUS" });
    expect(database.update).toHaveBeenCalled();
    expect(database.returning).toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.auditValues).not.toHaveBeenCalled();
  });
});

describe("candidate repository review", () => {
  it("approves with one conditional update before writing the audit", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "candidate-1" }]);
    const updateWhere = vi.fn().mockReturnValue({ returning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const auditValues = vi.fn().mockResolvedValue(undefined);
    const tx = {
      update: vi.fn().mockReturnValue({ set: updateSet }),
      insert: vi.fn().mockReturnValue({ values: auditValues }),
    };
    mocks.getDatabase.mockReturnValue({
      transaction: vi.fn(
        async (callback: (transaction: typeof tx) => unknown) => callback(tx),
      ),
    });

    await expect(
      reviewCandidate("candidate-1", "approve"),
    ).resolves.toMatchObject({
      ok: true,
      id: "candidate-1",
      status: "APPROVED",
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "APPROVED" }),
    );
    const reviewCondition = updateWhere.mock.calls[0]?.[0];
    expect(reviewCondition).toBeDefined();
    if (!reviewCondition) throw new Error("review condition was not captured");
    const reviewQuery = new PgDialect().sqlToQuery(reviewCondition.getSQL());
    expect(reviewQuery.params).toEqual(
      expect.arrayContaining([
        "candidate-1",
        "DISCOVERED",
        "REVIEW_REQUIRED",
      ]),
    );
    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "candidate.approve",
        candidateId: "candidate-1",
      }),
    );
  });

  it("does not audit a candidate that was already reviewed", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockReturnValue({ returning });
    const auditValues = vi.fn().mockResolvedValue(undefined);
    const tx = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: updateWhere }),
      }),
      insert: vi.fn().mockReturnValue({ values: auditValues }),
    };
    mocks.getDatabase.mockReturnValue({
      transaction: vi.fn(
        async (callback: (transaction: typeof tx) => unknown) => callback(tx),
      ),
    });

    await expect(
      reviewCandidate("candidate-1", "reject"),
    ).resolves.toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(auditValues).not.toHaveBeenCalled();
  });
});
