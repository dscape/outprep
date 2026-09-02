import { checkBotId } from "botid/server";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
};

export async function POST() {
  try {
    const verification = await checkBotId({
      advancedOptions: { checkLevel: "basic" },
    });

    if (verification.isBot) {
      return new Response(null, { status: 403, headers: NO_STORE_HEADERS });
    }

    return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
  } catch {
    return new Response(null, { status: 503, headers: NO_STORE_HEADERS });
  }
}
