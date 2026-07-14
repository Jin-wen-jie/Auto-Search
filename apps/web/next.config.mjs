/** @type {import('next').NextConfig} */
const config = {
  ...(process.env.NEXT_OUTPUT === "standalone"
    ? { output: "standalone" }
    : {}),
};

export default config;
