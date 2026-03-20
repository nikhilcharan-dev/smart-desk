import { NextResponse } from "next/server";
import getRedis from "@/lib/redis";

const PLATFORMS = ["windows", "macos", "linux", "ios"];
const KEY_PREFIX = "servera:downloads";

function key(platform) {
  return `${KEY_PREFIX}:${platform}`;
}

function todayKey(platform) {
  const d = new Date().toISOString().slice(0, 10);
  return `${KEY_PREFIX}:${platform}:daily:${d}`;
}

// GET — return counts for every platform
export async function GET() {
  try {
    const r = getRedis();
    await r.ping();

    const pipe = r.pipeline();
    for (const p of PLATFORMS) {
      pipe.get(key(p));           // total
      pipe.get(todayKey(p));      // today
    }
    const results = await pipe.exec();

    const counts = {};
    let totalAll = 0;
    PLATFORMS.forEach((p, i) => {
      const total = parseInt(results[i * 2][1] || "0", 10);
      const today = parseInt(results[i * 2 + 1][1] || "0", 10);
      counts[p] = { total, today };
      totalAll += total;
    });

    return NextResponse.json({ counts, totalAll });
  } catch (err) {
    console.error("[downloads GET]", err);
    return NextResponse.json(
      { counts: PLATFORMS.reduce((a, p) => ({ ...a, [p]: { total: 0, today: 0 } }), {}), totalAll: 0 },
      { status: 200 }
    );
  }
}

// POST — increment a platform counter
export async function POST(request) {
  try {
    const { platform } = await request.json();
    if (!PLATFORMS.includes(platform)) {
      return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
    }

    const r = getRedis();
    await r.ping();

    const pipe = r.pipeline();
    pipe.incr(key(platform));
    pipe.incr(todayKey(platform));
    pipe.expire(todayKey(platform), 86400 * 2); // auto-expire daily keys after 2 days
    const results = await pipe.exec();

    const newTotal = parseInt(results[0][1], 10);
    return NextResponse.json({ platform, total: newTotal });
  } catch (err) {
    console.error("[downloads POST]", err);
    return NextResponse.json({ error: "Counter unavailable" }, { status: 500 });
  }
}
