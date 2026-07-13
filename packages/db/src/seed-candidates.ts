import { eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { Db } from "./client";
import { discoveryCandidates } from "./schema";

export interface CandidateSeed {
  productUrl: string;
  sourceType: "manual" | "x" | "telegram";
  status?: "DISCOVERED" | "REVIEW_REQUIRED";
  extractionResult?: Record<string, unknown>;
}

/**
 * 已知 K12 / Bug Team 店铺链接。
 * 这些店铺来自公开的 AI 账号发卡平台，主要销售 K12 教育资格和 Bug Team 套餐。
 */
const BASE_CANDIDATES: CandidateSeed[] = [
  // ── ldxp.cn 发卡平台店铺 ──
  { productUrl: "https://pay.ldxp.cn/shop/JL7007", sourceType: "manual" },
  { productUrl: "https://pay.ldxp.cn/shop/caishen", sourceType: "manual" },
  { productUrl: "https://pay.ldxp.cn/shop/mengze", sourceType: "manual" },
  { productUrl: "https://pay.ldxp.cn/shop/6YEJH8PE", sourceType: "manual" },
  { productUrl: "https://pay.ldxp.cn/shop/XHA54E0U", sourceType: "manual" },
  { productUrl: "https://pay.ldxp.cn/shop/JBJJWNA5", sourceType: "manual" },
  // ── codesky.qzz.io 发卡平台 ──
  // 花生店铺，出售 GPT-K12 子号、Outlook、Gmail 等数字商品
  { productUrl: "https://store.codesky.qzz.io/item/8", sourceType: "manual" },
  // ── gptmf.com 发卡平台 ──
  // GPT魔法商店，出售 ChatGPT Team 账号
  { productUrl: "https://shop.gptmf.com/buy/26", sourceType: "manual" },
];

const PRICEAI_PUBLIC_RESEARCH_CANDIDATES = JSON.parse(String.raw`[
  {"productUrl":"https://pay.ldxp.cn/item/sa3mf0","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"bug team，250刀，cpa格式，需要其他格式自己转换","price":15.82,"merchantName":"Ai小铺","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (team_bug, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T07:04:31.604+00:00","inventory":192}},
  {"productUrl":"https://pay.ldxp.cn/item/3kznsw","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"gpt Team bug 子号 最低200刀（无质保，拿着卡密去兑换地址下载JSON文件）","price":1.02,"merchantName":"AI 云智聪聪","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (delivery_recharge, team_bug, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:28:52.097+00:00","inventory":0}},
  {"productUrl":"https://shop.aitonse.com/products/team01","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"team 成品bug号 200刀（无质保） / 规格4","price":1.6,"merchantName":"Auto Subscribe / shop.aitonse.com","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"UNAVAILABLE","note":"PriceAI public listing tagged Bug Team (delivery_account, team_bug); no fraud conclusion recorded.","observedAt":"2026-06-17T13:05:29.071+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/2dwdah","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"gpt Team bug 子号 最低200刀（无质保，拿着卡密去兑换地址下载JSON文件）","price":2.97,"merchantName":"ALL IN AI","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (delivery_recharge, team_bug, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:23:39.928+00:00","inventory":0}},
  {"productUrl":"https://catfk.com/item/aa5xrq","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"bugteam sub格式 json文件（质保下单半小时内首登）（量大预定）","price":5.6,"merchantName":"Xx-gpt-gemini","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (delivery_account, team_bug, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:39:09.602+00:00","inventory":0}},
  {"productUrl":"https://faka.aiceo.dev/products/tr_bug","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"【rt】bug team","price":7,"merchantName":"team","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"UNAVAILABLE","note":"PriceAI public listing tagged Bug Team (team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T06:50:04.723+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/j8mnr1","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"bugteam sub用 401自行可写脚本自动救 不是死了 账号都会测活发出 无售后","price":7.21,"merchantName":"鱼ai","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (delivery_account, team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T06:53:33.835+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/wlkl0h","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"bug team 240刀【发货JSON,一个小时内有问题给补,不会用的别拍】","price":7.21,"merchantName":"牟利ai","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T06:37:48.166+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/m3snce","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"BUG Team 凭证，质保首登","price":7.93,"merchantName":"FranklyBuilds的AI小店","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (delivery_account, team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T06:59:15.624+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/ruzck3","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"BUG Team 凭证，质保首登","price":8,"merchantName":"PLUS直营店","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (delivery_account, team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T06:30:02.702+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/kgtebx","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"Bug Team 150-200刀+月限 JSON文件 RT号","price":8.24,"merchantName":"ChatGptPlus 陌路专营店 分销码molu","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (team_bug, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:47:55.549+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/8hxnpk","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"【聪明渠道】bugteam","price":8.5,"merchantName":"AI深研社","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T06:23:05.79+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/9vtj7d","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"Bug Team 150-200刀+月限 JSON文件 RT号","price":9.27,"merchantName":"AI小店","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (team_bug, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:26:06.205+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/zk70i6","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"bugteam sub用 401自行可写脚本自动救 不是死了 账号都会测活发出 无售后","price":12.6,"merchantName":"lowfish的AI小铺","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (delivery_account, team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T07:08:01.664+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/iqldxg","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"tz-bugteam sub用 无售后顶级跑量 sub401自己救活 是subbug","price":13,"merchantName":"奥特曼严选","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T06:35:57.57+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/nf4n9z","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"【codex-反代】bugteam成品（只能反代，买错不退）","price":13.91,"merchantName":"小票的ai小铺","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (delivery_account, team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T06:51:00.867+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/7rursq","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"bugteam sub用 401自行可写脚本自动救 不是死了 账号都会测活发出 无售后","price":14.21,"merchantName":"如鱼得水(玩转ai)","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (delivery_account, team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T06:45:33.461+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/t6ix25","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"bug team【只有sub2能跑，其余的反代软件用不了】","price":14.32,"merchantName":"7878","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (team_bug, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:48:41.363+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/djew8i","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"bug team","price":14.32,"merchantName":"懒羊羊","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T06:43:10.38+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/okbdzz","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"bug team，250刀，cpa格式，需要其他格式自己转换","price":15.45,"merchantName":"梦泽","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (team_bug, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:46:36.785+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/i0b7g0","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"bug team","price":15.45,"merchantName":"东北23333--承接理工科毕设","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T06:33:22.72+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/rrs1jc","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"tz-bugteam sub用 无售后顶级跑量 sub401自己救活 是subbug","price":15.45,"merchantName":"青蛙AI·低价源头","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T06:28:03.172+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/felaa3","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"bugteam sub用 401自行可写脚本自动救 不是死了 账号都会测活发出 无售后","price":15.45,"merchantName":"明云小铺","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (delivery_account, team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T06:25:27.418+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/8lvsyt","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"tz-bugteam sub用 无售后顶级跑量 sub401自己救活 是subbug","price":15.7,"merchantName":"小猫GPT源头分销码：dxeoq4i7","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T06:33:56.382+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/b4fp94","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"bugteam sub用 401自行可写脚本自动救 不是死了 账号都会测活发出 无售后","price":16.07,"merchantName":"极速Ai","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"Bug Team","availability":"IN_STOCK","note":"PriceAI public listing tagged Bug Team (delivery_account, team_bug); no fraud conclusion recorded.","observedAt":"2026-07-12T06:17:37.875+00:00","inventory":0}},
  {"productUrl":"https://pay.ldxp.cn/item/z67ry0","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"k12 json 格式 gmail，兑换会进行测活，导入401 售后，后续其余不进行任何售后","price":1.13,"merchantName":"FranklyBuilds的AI小店","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:59:15.624+00:00","inventory":30}},
  {"productUrl":"https://pay.ldxp.cn/item/9ut7wz","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"k12子号 反代 保首登（CPA+sub2api格式发货）--子号--不支持网页登录","price":1.85,"merchantName":"牟利ai","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:37:48.166+00:00","inventory":182}},
  {"productUrl":"https://pay.ldxp.cn/item/tygrdi","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"GPT Team K12 成品 JSON 反代 发cpa 质保首登","price":1.9,"merchantName":"如鱼得水(玩转ai)","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:45:33.461+00:00","inventory":56}},
  {"productUrl":"https://pay.ldxp.cn/item/79kzm5","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"k12子号 反代 保首登（CPA+sub2api格式发货）--子号--不支持网页登录","price":2,"merchantName":"奥特曼严选","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:35:57.57+00:00","inventory":182}},
  {"productUrl":"https://pay.ldxp.cn/item/zn7ziu","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"微软邮箱 GPT Team K12 成品 JSON 反代 发cpa 质保首登 7.12号中午新货","price":2.06,"merchantName":"源头GPT","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T07:07:41.037+00:00","inventory":105}},
  {"productUrl":"https://pay.ldxp.cn/item/hfwbv2","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"k12 team 成品 限反代 保首登（无RT|CPA）11","price":2.06,"merchantName":"CAO","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T07:03:03.941+00:00","inventory":108}},
  {"productUrl":"https://pay.ldxp.cn/item/ugws9l","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"GPT Team K12 成品 JSON 反代 发cpa 质保首登","price":2.06,"merchantName":"ming的AI商店","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:49:26.401+00:00","inventory":31}},
  {"productUrl":"https://pay.ldxp.cn/item/gt4xbd","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"k12子号 反代 保首登（CPA+sub2api格式发货）--子号--不支持网页登录","price":2.06,"merchantName":"GPT-源头供货-招代理","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:34:52.066+00:00","inventory":185}},
  {"productUrl":"https://pay.ldxp.cn/item/wzvc62","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"微软邮箱 GPT Team K12 成品 JSON 反代 发cpa 质保首登 7.12号中午新货","price":2.11,"merchantName":"Ai小铺","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T07:04:31.604+00:00","inventory":108}},
  {"productUrl":"https://pay.ldxp.cn/item/rm7soh","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"k12子号 反代 保首登（CPA+sub2api格式发货）--子号--不支持网页登录","price":2.22,"merchantName":"一梦AI","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:42:23.616+00:00","inventory":167}},
  {"productUrl":"https://pay.ldxp.cn/item/4mvjf1","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"微软邮箱 GPT Team K12 成品 JSON 反代 发cpa 质保首登 7.12号中午新货","price":2.25,"merchantName":"黑白小狗AI旗舰店","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:55:40.297+00:00","inventory":175}},
  {"productUrl":"https://pay.ldxp.cn/item/bztyln","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"微软邮箱 GPT Team K12 成品 JSON 反代 发cpa 质保首登 7.12号中午新货","price":2.27,"merchantName":"梦泽","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:46:36.785+00:00","inventory":235}},
  {"productUrl":"https://pay.ldxp.cn/item/raj9c4","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"微软邮箱 GPT Team K12 成品 JSON 反代 发cpa 质保首登 7.12号中午新货","price":2.37,"merchantName":"chiyu","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:21:41.049+00:00","inventory":293}},
  {"productUrl":"https://pay.ldxp.cn/item/ai255p","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"微软邮箱 GPT Team K12 成品 JSON 反代 发cpa 质保首登 7.12号中午新货","price":2.5,"merchantName":"陆柒科技","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:30:04.717+00:00","inventory":308}},
  {"productUrl":"https://pay.ldxp.cn/item/5bav0k","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"k12 team成品","price":2.56,"merchantName":"7878","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12); no fraud conclusion recorded.","observedAt":"2026-07-12T06:48:41.363+00:00","inventory":28}},
  {"productUrl":"https://pay.ldxp.cn/item/ohroa6","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"k12 成品号 只可反代 质保首登 额度在100刀左右 不会用勿拍 拍了不退","price":2.58,"merchantName":"Hug AI","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:19:58.819+00:00","inventory":378}},
  {"productUrl":"https://pay.ldxp.cn/item/pzj0gp","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"谷歌GPT K12 成品1个｜Sub2API/CPA JSON可选｜首登质保｜可刷AT","price":2.78,"merchantName":"AI小铺","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:27:06.974+00:00","inventory":163}},
  {"productUrl":"https://pay.ldxp.cn/item/yggdut","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"k12 team成品","price":2.88,"merchantName":"金幺の小店","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12); no fraud conclusion recorded.","observedAt":"2026-07-12T07:06:37.914+00:00","inventory":18}},
  {"productUrl":"https://pay.ldxp.cn/item/k14r5c","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"GPT Team K12 成品 JSON 反代 发cpa/cdk 质保首登","price":2.88,"merchantName":"NiuGe AI 加钟站","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_recharge, delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:55:10.392+00:00","inventory":216}},
  {"productUrl":"https://pay.ldxp.cn/item/s4xe80","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"GPT Team K12 成品 JSON 反代 发cpa 质保首登 7.12号中午新货","price":2.9,"merchantName":"小猫GPT源头分销码：dxeoq4i7","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:33:56.382+00:00","inventory":302}},
  {"productUrl":"https://pay.ldxp.cn/item/6get4g","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"《精品》基本存活超过1天！ 谷歌GPTK12 team K12 成品/可刷AT","price":2.9,"merchantName":"卖点AI","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, duration_trial); no fraud conclusion recorded.","observedAt":"2026-07-12T06:25:51.348+00:00","inventory":49}},
  {"productUrl":"https://pay.ldxp.cn/item/cgvr1j","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"k12 team成品","price":3.08,"merchantName":"懒羊羊","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12); no fraud conclusion recorded.","observedAt":"2026-07-12T06:43:10.38+00:00","inventory":30}},
  {"productUrl":"https://pay.ldxp.cn/item/te23fd","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"GPT Team K12 成品 JSON 反代 发cpa/cdk 质保首登","price":3.08,"merchantName":"雪豹AI","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_recharge, delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:24:53.05+00:00","inventory":222}},
  {"productUrl":"https://pay.ldxp.cn/item/1dx0u8","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"微软邮箱 GPT Team K12 成品 JSON 反代 发cpa 质保首登 7.12号中午新货","price":3.09,"merchantName":"哈哈的ai杂货铺","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:57:34.633+00:00","inventory":135}},
  {"productUrl":"https://pay.ldxp.cn/item/qs99fb","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"k12 子号，反代无售后","price":3.09,"merchantName":"ai教父","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (team_k12); no fraud conclusion recorded.","observedAt":"2026-07-12T06:40:27.094+00:00","inventory":35}}
]`) as CandidateSeed[];

const PRICEAI_PUBLIC_RESEARCH_EXTRA_CANDIDATES = JSON.parse(String.raw`[
  {"productUrl":"https://pay.ldxp.cn/item/ccxcfn","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"GPT Team K12 成品 JSON 反代 发cpa 质保首登","price":3.09,"merchantName":"东北23333--承接理工科毕设","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:33:22.72+00:00","inventory":93}},
  {"productUrl":"https://pay.ldxp.cn/item/hlqaww","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"微软邮箱 GPT Team K12 成品 JSON 反代 发cpa 质保首登 7.12号中午新货","price":3.09,"merchantName":"青蛙AI·低价源头","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:28:03.172+00:00","inventory":325}},
  {"productUrl":"https://pay.ldxp.cn/item/bxb8bl","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"谷歌 GPT K12 成品1个｜Sub2API/CPA JSON可选｜首登质保｜可刷AT","price":3.2,"merchantName":"IMAGE-2","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:57:59.659+00:00","inventory":217}},
  {"productUrl":"https://pay.ldxp.cn/item/m7cry4","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"GPT Team K12 成品 JSON 反代 发cpa 质保首登","price":3.3,"merchantName":"小柴AI","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:49:33.695+00:00","inventory":31}},
  {"productUrl":"https://pay.ldxp.cn/item/dz41ga","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"谷歌GPT K12 成品1个｜Sub2API/CPA JSON可选｜首登质保｜可刷AT","price":3.36,"merchantName":"team最后的余晖","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:52:47.536+00:00","inventory":350}},
  {"productUrl":"https://pay.ldxp.cn/item/8didxf","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"k12 成品号 只可反代 质保首登 额度在100刀左右 不会用勿拍 拍了不退","price":3.5,"merchantName":"源头的ai","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T07:09:41.137+00:00","inventory":365}},
  {"productUrl":"https://pay.ldxp.cn/item/oh4f9g","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"GPT Team K12 成品 JSON 反代 发cpa/cdk 质保首登","price":3.8,"merchantName":"北极星AI","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_recharge, delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T07:09:28.141+00:00","inventory":214}},
  {"productUrl":"https://pay.ldxp.cn/item/xgim2c","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"GPT Team K12 成品 JSON 反代 发cpa/cdk 质保首登","price":3.91,"merchantName":"ALL IN AI","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_recharge, delivery_account, team_k12, proxy_supported); no fraud conclusion recorded.","observedAt":"2026-07-12T06:23:39.928+00:00","inventory":222}},
  {"productUrl":"https://pay.ldxp.cn/item/p2ul10","sourceType":"manual","status":"REVIEW_REQUIRED","extractionResult":{"pageTitle":"k12 team成品","price":4,"merchantName":"光之国AI","sourceUrl":"https://priceai.cc/products/chatgpt-team-business","focus":"K12","availability":"IN_STOCK","note":"PriceAI public listing tagged K12 (delivery_account, team_k12); no fraud conclusion recorded.","observedAt":"2026-07-12T07:02:21.91+00:00","inventory":20}}
]`) as CandidateSeed[];

export const INITIAL_CANDIDATES: CandidateSeed[] = [
  ...BASE_CANDIDATES,
  ...PRICEAI_PUBLIC_RESEARCH_CANDIDATES,
  ...PRICEAI_PUBLIC_RESEARCH_EXTRA_CANDIDATES,
];

/**
 * 已知的发卡平台域名。
 * 这些平台托管了多个 K12/BugTeam 店铺，连接器发现时优先关注这些域名。
 */
export const KNOWN_PLATFORMS: string[] = [
  "ldxp.cn",
  "ldxp.cn/shop",           // 发卡平台子路径模式
  "codesky.qzz.io",         // QZZ 建站发卡平台（多店模式）
  "gptmf.com",
];

/**
 * URL 规范化：移除 fragment，保留 query 参数。
 */
function canonicalizeUrl(productUrl: string): string {
  const url = new URL(productUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("UNSUPPORTED_URL_PROTOCOL");
  }
  url.hash = "";
  return url.toString();
}

function fingerprintUrl(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl).digest("hex");
}

/**
 * 将初始候选链接写入数据库。
 * 如果 URL 指纹已存在则跳过（幂等）。
 */
export async function seedCandidates(
  db: Db,
  candidates: readonly CandidateSeed[] = INITIAL_CANDIDATES,
): Promise<void> {
  const uniqueCandidates = new Map<
    string,
    { candidate: CandidateSeed; canonicalUrl: string }
  >();

  for (const candidate of candidates) {
    const canonicalUrl = canonicalizeUrl(candidate.productUrl);
    const urlFingerprint = fingerprintUrl(canonicalUrl);
    if (!uniqueCandidates.has(urlFingerprint)) {
      uniqueCandidates.set(urlFingerprint, { candidate, canonicalUrl });
    }
  }

  for (const [urlFingerprint, seed] of uniqueCandidates) {
    const { candidate, canonicalUrl } = seed;

    const [existing] = await db
      .select({ id: discoveryCandidates.id })
      .from(discoveryCandidates)
      .where(eq(discoveryCandidates.urlFingerprint, urlFingerprint))
      .limit(1);

    if (existing) continue;

    await db.insert(discoveryCandidates).values({
      id: randomUUID(),
      productUrl: canonicalUrl,
      canonicalUrl,
      urlFingerprint,
      sourceType: candidate.sourceType,
      status: candidate.status ?? "DISCOVERED",
      extractionResult: candidate.extractionResult ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seeded ${uniqueCandidates.size} candidate URLs (deduplicated by fingerprint)`,
  );
}
