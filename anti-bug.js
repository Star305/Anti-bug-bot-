const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');

const PHONE_NUMBER = '2347012345678';           // ← CHANGE TO YOUR NUMBER (only digits, no + or spaces)
const OWNER = PHONE_NUMBER + '@s.whatsapp.net';

const AUTH_FOLDER = './auth_info';

const spamMap = new Map();
const SPAM_THRESHOLD = 6;
const SPAM_WINDOW = 8000;

const BUG_PATTERNS = [
  /[\u200B\u200C\u200D\uFEFF\u00A0]{4,}/i,
  /(.)\1{25,}/,
  /^[\s\u200B\u200C\u200D\uFEFF]*$/,
  /[\u{1F600}-\u{1F64F}]{15,}/u,
];

let pairingCodeRequested = false;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,           // No QR anymore
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('Desktop'), // Best for pairing code
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Generate pairing code on first connection
    if ((connection === 'connecting' || !!qr) && !pairingCodeRequested) {
      pairingCodeRequested = true;

      if (!sock.authState.creds.registered) {
        try {
          const code = await sock.requestPairingCode(PHONE_NUMBER);
          const formatted = code.match(/.{1,4}/g)?.join('-') || code;

          console.log('\n🔑════════════════════════════════════');
          console.log(`   YOUR WHATSAPP PAIRING CODE: ${formatted}`);
          console.log('════════════════════════════════════');
          console.log('📱 How to link:');
          console.log('1. Open WhatsApp on your phone');
          console.log('2. Go to Settings → Linked Devices');
          console.log('3. Tap "Link a Device"');
          console.log('4. Choose "Link with phone number instead"');
          console.log('5. Type the code above\n');
        } catch (err) {
          console.log('❌ Error generating pairing code:', err.message);
        }
      }
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error instanceof Boom 
        ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut 
        : true;

      console.log('❌ Disconnected. Reconnecting in 3 seconds...');
      if (shouldReconnect) setTimeout(startBot, 3000);
    } else if (connection === 'open') {
      console.log('✅ ANTI-BUG BOT PRO v2.1 CONNECTED WITH PAIRING CODE!');
      console.log('🌹 Mr. Emmanuel Protection Active 24/7');
      await sock.sendMessage(OWNER, { text: '🚨 *ANTI-BUG BOT PRO v2.1 ACTIVATED*\n✅ Now using Pairing Code (no QR)\nI am protecting your WhatsApp forever.' });
    }
  });

  // Rest of the anti-bug protection (exactly same as before, perfect)
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      if (!m.message) continue;
      const from = m.key.remoteJid;
      if (!from || from === 'status@broadcast') continue;

      const sender = m.key.participant || from;
      const msgText = m.message.conversation || m.message.extendedTextMessage?.text || '';

      if (sender === OWNER && msgText.startsWith('.')) {
        if (msgText === '.status') await sock.sendMessage(OWNER, { text: '✅ Bot is running perfectly on Render with Pairing Code!' });
        if (msgText === '.unblockall') {
          const list = await sock.fetchBlocklist();
          for (const j of list) await sock.updateBlockStatus(j, 'unblock');
          await sock.sendMessage(OWNER, { text: `✅ Unblocked ${list.length} numbers` });
        }
        continue;
      }

      let isBug = false;
      let reason = '';

      const now = Date.now();
      if (!spamMap.has(sender)) spamMap.set(sender, {count:0, last:now});
      const data = spamMap.get(sender);
      if (now - data.last < SPAM_WINDOW) data.count++; else { data.count=1; data.last=now; }
      if (data.count >= SPAM_THRESHOLD) { isBug=true; reason='FLOOD ATTACK'; }

      if (!isBug) {
        for (const pat of BUG_PATTERNS) {
          if (pat.test(msgText)) { isBug=true; reason='CRASH/BUG PATTERN'; break; }
        }
      }
      if (!isBug && msgText.length > 2800) { isBug=true; reason='MASSIVE TEXT BOMB'; }

      if (isBug) {
        console.log(`🚫 BLOCKED ${sender} → ${reason}`);
        await sock.sendMessage(OWNER, { text: `🚨 ANTI-BUG ALERT!\nFrom: ${sender}\nReason: ${reason}` });
        await sock.updateBlockStatus(sender, 'block');
        spamMap.delete(sender);
      }
    }
  });

  // 30-minute reminder
  setInterval(() => {
    sock.sendMessage(OWNER, { text: '🛡️ Anti-Bug Bot PRO is still protecting you (Pairing Code Mode)' });
  }, 1800000);
}

startBot().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
