import crypto from "crypto";

const APPS_SCRIPT_WEB_APP_URL =
  process.env.APPS_SCRIPT_WEB_APP_URL ||
  "https://script.google.com/macros/s/AKfycbwJ6JgQWqmhp9Y7gWPKvr5l5IixbWuNRAsbJ0km6AQIGuUBlniZeDfOpqtkGds-pxzB/exec";

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
                text: "お客様はLINEから簡単に予約",
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
                text: "予約確認は自動で送信",
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
                text: "前日 / 3時間前リマインド送信",
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
                text: "4",
                flex: 0,
                weight: "bold",
                color: "#2F4F3E",
                size: "lg"
              },
              {
                type: "text",
                text: "確認・キャンセルをLINE上で完結",
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
            text: "やり取りの手間を減らし、スムーズなサロン運営を実現します。",
            wrap: true,
            color: "#555555",
            size: "sm"
          },
          {
            type: "text",
            text: "※現在、サロン様向けにデモ公開中",
            wrap: true,
            color: "#8A8A8A",
            size: "xs",
            margin: "md"
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
              label: "実際に体験する",
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
                text: "✓ 予約対応の手間を削減",
                wrap: true,
                color: "#333333",
                size: "md"
              },
              {
                type: "text",
                text: "✓ 営業時間外でも受付可能",
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
                text: "✓ 無断キャンセル対策にも対応",
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
            text: "スタッフの負担を減らし、接客に集中できる環境をつくります。",
            wrap: true,
            color: "#555555",
            size: "sm"
          },
          {
            type: "text",
            text: "※現在、サロン様向けにデモ公開中",
            wrap: true,
            color: "#8A8A8A",
            size: "xs",
            margin: "md"
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
              label: "導入について相談する",
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
    return [
      buildHowItWorksFlex(),
      {
        type: "text",
        text: "次に何をしますか？",
        quickReply: {
          items: [
            {
              type: "action",
              action: {
                type: "uri",
                label: "実際に体験する",
                uri: "https://line-app-xi.vercel.app/"
              }
            },
            {
              type: "action",
              action: {
                type: "message",
                label: "導入メリットを見る",
                text: "導入メリット"
              }
            }
          ]
        }
      }
    ];
  }

  if (text === "導入メリット") {
    return [
      buildBenefitsFlex(),
      {
        type: "text",
        text: "ご希望の内容を選択してください👇",
        quickReply: {
          items: [
            {
              type: "action",
              action: {
                type: "uri",
                label: "相談する （約30秒で入力できます）",
                uri: "https://line-app-xi.vercel.app/?screen=lead"
              }
            },
            {
              type: "action",
              action: {
                type: "uri",
                label: "デモを見る",
                uri: "https://line-app-xi.vercel.app/"
              }
            }
          ]
        }
      }
    ];
  }

  if (text === "相談する" || text === "お問い合わせ") {
    return [
      {
        type: "text",
        text:
          "ご相談ありがとうございます😊\n\n" +
          "LINEからそのまま導入相談が可能です。\n\n" +
          "下のリンクからフォームを開き、\n" +
          "必要事項をご入力ください。\n\n" +
          "内容を確認後、個別にご案内いたします。"
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

function parsePostbackData(data) {
  const params = new URLSearchParams(String(data || ""));
  return {
    action: params.get("action") || "",
    bookingId: params.get("bookingId") || ""
  };
}

async function callAppsScript(payload) {
  const res = await fetch(APPS_SCRIPT_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Apps Script returned invalid JSON: ${text}`);
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
      // POSTBACK: подтверждение / отмена
      if (event.type === "postback" && event.postback?.data && event.replyToken) {
        const { action, bookingId } = parsePostbackData(event.postback.data);

        if (action && bookingId) {
          const appResult = await callAppsScript({
            mode: "line_action",
            action,
            bookingId,
            userId: event.source?.userId || "",
            source: "vercel_line_webhook"
          });

          const lineMessages =
            Array.isArray(appResult?.lineMessages) && appResult.lineMessages.length
              ? appResult.lineMessages
              : [{
                  type: "text",
                  text: appResult?.message || "処理が完了しました。"
                }];

          await replyMessage(event.replyToken, lineMessages, channelAccessToken);
        }

        continue;
      }

      // обычные menu message reply
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