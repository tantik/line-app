import crypto from "crypto";

function verifyLineSignature(body, signature, channelSecret) {
  const hash = crypto
    .createHmac("SHA256", channelSecret)
    .update(body)
    .digest("base64");

  return hash === signature;
}

function getMenuReplyText(text) {
  if (text === "仕組みを見る") {
    return (
      "LINEで予約受付を自動化できます✨\n\n" +
      "このデモでできること\n" +
      "・LINEから予約受付\n" +
      "・予約確認メッセージ送信\n" +
      "・前日リマインド送信\n" +
      "・店舗側への通知\n\n" +
      "予約対応の手間を減らし、\n" +
      "よりスムーズな運営につなげられます。"
    );
  }

  if (text === "導入メリット") {
    return (
      "導入メリットはこちらです📈\n\n" +
      "・営業時間外でも予約受付が可能\n" +
      "・予約対応の手間を削減\n" +
      "・確認やリマインドを自動化\n" +
      "・スタッフ共有をスムーズに\n" +
      "・無断キャンセル対策の基盤づくり\n\n" +
      "サロン側の負担を減らし、\n" +
      "接客に集中しやすくなります。"
    );
  }

  if (text === "相談する" || text === "お問い合わせ") {
    return (
      "ご相談ありがとうございます😊\n\n" +
      "このままLINEでお気軽にご連絡ください。\n\n" +
      "例えば：\n" +
      "・料金について\n" +
      "・導入について\n" +
      "・デモ説明"
    );
  }

  return null;
}

async function replyMessage(replyToken, text, channelAccessToken) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [
        {
          type: "text",
          text,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`LINE reply failed: ${res.status} ${errorText}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, message: "line webhook endpoint" });
  }

  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!channelSecret || !channelAccessToken) {
    return res.status(500).json({ ok: false, error: "Missing LINE env vars" });
  }

  try {
    const rawBody =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    const signature = req.headers["x-line-signature"];

    if (!signature) {
      return res.status(400).json({ ok: false, error: "Missing x-line-signature" });
    }

    const isValidSignature = verifyLineSignature(
      rawBody,
      signature,
      channelSecret
    );

    if (!isValidSignature) {
      return res.status(401).json({ ok: false, error: "Invalid signature" });
    }

    const data = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const events = Array.isArray(data.events) ? data.events : [];

    // ВАЖНО: на verify LINE может прислать events: []
    if (events.length === 0) {
      return res.status(200).json({ ok: true });
    }

    for (const event of events) {
      if (event.type !== "message") continue;
      if (!event.message || event.message.type !== "text") continue;
      if (!event.replyToken) continue;

      const userText = String(event.message.text || "").trim();
      const replyText = getMenuReplyText(userText);

      if (!replyText) continue;

      await replyMessage(event.replyToken, replyText, channelAccessToken);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("LINE webhook error:", error);
    return res.status(200).json({ ok: false, error: error.message });
  }
}