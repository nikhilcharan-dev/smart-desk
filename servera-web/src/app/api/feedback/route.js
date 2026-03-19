import { NextResponse } from "next/server";
import getRedis from "@/lib/redis";

const KEY_LIST = "servera:feedback:list";        // sorted set (score = timestamp)
const KEY_STATS = "servera:feedback:stats";       // hash  { total, avg, 1..5 star counts }
const KEY_RATINGS = "servera:feedback:ratings";   // hash  { 1: count, 2: count, ... 5: count }

// GET — return all feedback + aggregate stats
export async function GET(request) {
  try {
    const r = getRedis();
    await r.ping();

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const type = url.searchParams.get("type"); // feedback | complaint | discussion | null

    const start = (page - 1) * limit;
    const end = start + limit - 1;

    // get feedback entries (newest first)
    const raw = await r.zrevrange(KEY_LIST, 0, -1);
    let entries = raw.map((s) => JSON.parse(s));

    // filter by type if specified
    if (type) {
      entries = entries.filter((e) => e.type === type);
    }

    const total = entries.length;
    const paged = entries.slice(start, start + limit);

    // get aggregate stats
    const [totalCount, ratingCounts] = await Promise.all([
      r.hget(KEY_STATS, "total"),
      r.hgetall(KEY_RATINGS),
    ]);

    // compute average
    let sumRating = 0;
    let ratingTotal = 0;
    for (let star = 1; star <= 5; star++) {
      const c = parseInt(ratingCounts[star] || "0", 10);
      sumRating += star * c;
      ratingTotal += c;
    }
    const avgRating = ratingTotal > 0 ? (sumRating / ratingTotal).toFixed(1) : "0.0";

    return NextResponse.json({
      entries: paged,
      total,
      page,
      limit,
      stats: {
        totalFeedback: parseInt(totalCount || "0", 10),
        avgRating: parseFloat(avgRating),
        ratingBreakdown: {
          1: parseInt(ratingCounts["1"] || "0", 10),
          2: parseInt(ratingCounts["2"] || "0", 10),
          3: parseInt(ratingCounts["3"] || "0", 10),
          4: parseInt(ratingCounts["4"] || "0", 10),
          5: parseInt(ratingCounts["5"] || "0", 10),
        },
        totalRatings: ratingTotal,
      },
    });
  } catch (err) {
    console.error("[feedback GET]", err);
    return NextResponse.json({
      entries: [], total: 0, page: 1, limit: 20,
      stats: { totalFeedback: 0, avgRating: 0, ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, totalRatings: 0 },
    });
  }
}

// POST — submit new feedback
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, email, type, rating, message, platform } = body;

    if (!message || !message.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }
    if (!type || !["feedback", "complaint", "discussion"].includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const r = getRedis();
    await r.ping();

    const entry = {
      id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: (name || "Anonymous").trim().slice(0, 100),
      email: (email || "").trim().slice(0, 200),
      type,
      rating: rating ? Math.min(5, Math.max(1, parseInt(rating, 10))) : null,
      message: message.trim().slice(0, 2000),
      platform: platform || null,
      createdAt: new Date().toISOString(),
    };

    const pipe = r.pipeline();
    pipe.zadd(KEY_LIST, Date.now(), JSON.stringify(entry));
    pipe.hincrby(KEY_STATS, "total", 1);
    if (entry.rating) {
      pipe.hincrby(KEY_RATINGS, String(entry.rating), 1);
    }
    await pipe.exec();

    return NextResponse.json({ success: true, entry });
  } catch (err) {
    console.error("[feedback POST]", err);
    return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
  }
}
