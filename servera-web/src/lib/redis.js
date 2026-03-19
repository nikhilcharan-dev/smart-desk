import Redis from "ioredis";

let redis;

function getRedis() {
  if (!redis) {
    redis = new Redis({
      host: process.env.REDIS_HOST || "68.233.119.14",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      password: process.env.REDIS_PASSWORD || "redis@redis",
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      lazyConnect: true,
    });
    redis.on("error", (err) => console.error("[Redis]", err.message));
  }
  return redis;
}

export default getRedis;
