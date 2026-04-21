import crypto from "crypto";

function verifyLineSignature(body, signature, channelSecret) {
  const hash = crypto
    .createHmac("SHA256", channelSecret)
    .update(body)
    .digest("base64");

  return hash === signature;
}

function buildHowItWorksFlex() {
  return {
    type: "flex",
    altText: "仕組みを見る",
    contents: {
      type: "bubble",
      size: "giga",
      hero: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        backgroundColor: "#2F4F3E",
        contents: [
          {
            type: "text",
            text: "LINE予約の流れ",
            color: "#FFFFFF",
            weight: "bold",
            size: "xl"
          },
          {
            type: "text",
            text: "サロン向け予約自動化デモ",
            color: "#E8EFEA",
            size: "sm",
            margin: "md"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "lg",
        paddingAll: "20px",
        backgroundColor: "#F8F5EF",
        contents: [
          {
            type: "box",
            layout: "baseline",
            spacing: "md",
            contents: [
              {
                type: "text",
                text: "1",
                flex: 0,
                weight: "bold",
                color: "#2F4F3E",
                size: "lg"
              },
              {
                type: "text",
                text: "LINEから簡単に予約",
                wrap: true,
                color: "#333333",
                size: "md"
              }
            ]
          },
          {
            type: "box",
            layout: "baseline",
            spacing: "md",
            contents: [
              {
                type: "text",
                text: "2",
                flex: 0,
                weight: "bold",
                color: "#2F4F3E",
                size: "lg"
              },
              {
                type: "text",
                text: "予約確認メッセージを自動送信",
                wrap: true,
                color: "#333333",
                size: "md"
              }
            ]
          },
          {
            type: "box",
            layout: "baseline",
            spacing: "md",
            contents: [
              {
                type: "text",
                text: "3",
                flex: 0,
                weight: "bold",
                color: "#2F4F3E",
                size: "lg"
              },
              {
                type: "text",
                text: "来店前日にリマインド通知",
                wrap: true,
                color: "#333333",
                size: "md"
              }
            ]
          },
          {
            type: "separator",
            margin: "md"
          },
          {
            type: "text",
            text: "予約対応の手間を減らし、よりスムーズな運営につなげられます。",
            wrap: true,
            color: "#555555",
            size: "sm"
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        backgroundColor: "#F8F5EF",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: "#2F4F3E",
            action: {
              type: "uri",
              label: "デモを試す",
              uri: "https://line-app-xi.vercel.app/"
            }
          }
        ]
      }
    }
  };
}

function buildBenefitsFlex() {
  return {
    type: "flex",
    altText: "導入メリット",
    contents: {
      type: "bubble",
      size: "giga",
      hero: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        backgroundColor: "#2F4F3E",
        contents: [
          {
            type: "text",
            text: "導入メリット",
            color: "#FFFFFF",
            weight: "bold",
            size: "xl"
          },
          {
            type: "text",
            text: "サロン運営をもっとシンプルに",
            color: "#E8EFEA",
            size: "sm",
            margin: "md"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "lg",
        paddingAll: "20px",
        backgroundColor: "#F8F5EF",
        contents: [
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: "✓ 営業時間外でも予約受付が可能",
                wrap: true,
                color: "#333333",
                size: "md"
              },
              {
                type: "text",
                text: "✓ 予約対応の手間を削減",
                wrap: true,
                color: "#333333",
                size: "md"
              },
              {
                type: "text",
                text: "✓ 確認やリマインドを自動化",
                wrap: true,
                color: "#333333",
                size: "md"
              },
              {
                type: "text",
                text: "✓ スタッフ共有をスムーズに",
                wrap: true,
                color: "#333333",
                size: "md"
              },
              {
                type: "text",
                text: "✓ 無断キャンセル対策の基盤づくり",
                wrap: true,
                color: "#333333",
                size: "md"
              }
            ]
          },
          {
            type: "separator",
            margin: "md"
          },
          {
            type: "text",
            text: "サロン側の負担を減らし、接客に集中しやすくなります。",
            wrap: true,
            color: "#555555",
            size: "sm"
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        backgroundColor: "#F8F5EF",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: "#2F4F3E",
            action: {
              type: "uri",
              label: "相談する",
              uri: "https://line-app-xi.vercel.app/?screen=lead"
            }
          }
        ]
      }
    }
  };
}

function getMenuReplyMessage(text) {
  if (text === "仕組みを見る") {
    return [buildHowItWorksFlex()];
  }

  if (text === "導入メリット") {
    return [buildBenefitsFlex()];
  }

  if (text === "相談する" || text === "お問い合わせ") {
    return [
      {
        type: "text",
        text:
          "ご相談ありがとうございます😊\n\n" +
          "下のリンクからそのままご相談フォームを開けます。\n" +
          "必要事項を入力いただければ、確認後にご案内します。"
      },
      {
        type: "text",
        text: "https://line-app-xi.vercel.app/?screen=lead"
      }
    ];
  }

  return null;
}

async function replyMessage(replyToken, messages, channelAccessToken) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages
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

    const isValidSignature = verifyLineSignature(rawBody, signature, channelSecret);

    if (!isValidSignature) {
      return res.status(401).json({ ok: false, error: "Invalid signature" });
    }

    const data = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const events = Array.isArray(data.events) ? data.events : [];

    if (events.length === 0) {
      return res.status(200).json({ ok: true });
    }

    for (const event of events) {
      if (event.type !== "message") continue;
      if (!event.message || event.message.type !== "text") continue;
      if (!event.replyToken) continue;

      const userText = String(event.message.text || "").trim();
      const replyMessages = getMenuReplyMessage(userText);

      if (!replyMessages) continue;

      await replyMessage(event.replyToken, replyMessages, channelAccessToken);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("LINE webhook error:", error);
    return res.status(200).json({ ok: false, error: error.message });
  }
}