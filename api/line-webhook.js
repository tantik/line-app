// api/line-webhook.js
// Vercel Serverless Function for LINE Messaging API webhook
// Handles booking confirmations, cancellations, and reminders

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Verify LINE signature
function verifyLineSignature(body, signature) {
  if (!CHANNEL_SECRET) {
    console.error('LINE_CHANNEL_SECRET not configured');
    return false;
  }
  
  const hash = crypto
    .createHmac('sha256', CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  
  return hash === signature;
}

// Send LINE message using Messaging API
async function sendLineMessage(userId, message) {
  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: [message],
      }),
    });

    if (!response.ok) {
      console.error('LINE API error:', await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to send LINE message:', error);
    return false;
  }
}

// Handle postback action (confirmation/cancellation)
async function handlePostback(event) {
  const { source, postbackData } = event;
  const userId = source.userId;
  
  try {
    // Parse postback data (format: "action=confirm&booking_id=xxx" or similar)
    const params = new URLSearchParams(postbackData);
    const action = params.get('action');
    const bookingId = params.get('booking_id');

    if (!bookingId) {
      console.error('Missing booking_id in postback');
      return;
    }

    // Update booking status based on action
    const newStatus = action === 'confirm' ? 'confirmed' : 'cancelled';
    
    const { error } = await supabase
      .from('bookings')
      .update({ 
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .eq('line_user_id', userId);

    if (error) {
      console.error('Failed to update booking:', error);
      return;
    }

    // Send confirmation message
    const statusText = action === 'confirm' ? '予約が確定しました' : 'キャンセルされました';
    const replyMessage = {
      type: 'text',
      text: `ご予約${statusText}。`,
    };

    await sendLineMessage(userId, replyMessage);
  } catch (error) {
    console.error('Error handling postback:', error);
  }
}

// Handle message event
async function handleMessage(event) {
  const { source, message } = event;
  const userId = source.userId;

  // Echo message for now (can be extended for commands)
  const replyMessage = {
    type: 'text',
    text: message.text,
  };

  await sendLineMessage(userId, replyMessage);
}

// Handle follow event
async function handleFollow(event) {
  const { source } = event;
  const userId = source.userId;

  const welcomeMessage = {
    type: 'text',
    text: 'ミラウィサロンへようこそ！\nこちらから予約を取ることができます。\nデモアプリをお試しください。',
  };

  await sendLineMessage(userId, welcomeMessage);
}

// Main webhook handler
export default async function handler(req, res) {
  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify LINE signature
  const signature = req.headers['x-line-signature'];
  const body = JSON.stringify(req.body);

  if (!verifyLineSignature(body, signature)) {
    console.error('Invalid LINE signature');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Process webhook events
  const { events } = req.body;

  if (!events || !Array.isArray(events)) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  for (const event of events) {
    try {
      switch (event.type) {
        case 'postback':
          await handlePostback(event);
          break;
        case 'message':
          if (event.message.type === 'text') {
            await handleMessage(event);
          }
          break;
        case 'follow':
          await handleFollow(event);
          break;
        case 'unfollow':
          console.log('User unfollowed:', event.source.userId);
          break;
        default:
          console.log('Unhandled event type:', event.type);
      }
    } catch (error) {
      console.error('Error processing event:', error);
    }
  }

  // Always return 200 OK to LINE
  return res.status(200).json({ ok: true });
}
