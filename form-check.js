const puppeteer = require("puppeteer-core");
const nodemailer = require("nodemailer");

const BASE_URL = process.env.URL;

async function sendEmail(subject, text) {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: Number(process.env.EMAIL_PORT) === 465,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const recipients = process.env.EMAIL_TO.split(",").map((email) => email.trim());

  await transporter.sendMail({
    from: `"Form Bot" <${process.env.EMAIL_USER}>`,
    to: recipients,
    subject,
    text,
  });
}

function nowIso() {
  return new Date().toISOString();
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  // Збільшимо таймаути, бо сайт/капча можуть бути повільнішими
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  // Debug collectors
  const debug = {
    console: [],
    requestFailed: [],
    responses: [],
  };

  page.on("console", (msg) => {
    const text = msg.text();
    debug.console.push(text);
    if (debug.console.length > 40) debug.console.shift();
  });

  page.on("pageerror", (err) => {
    debug.console.push(`PAGEERROR: ${err.message}`);
    if (debug.console.length > 40) debug.console.shift();
  });

  page.on("requestfailed", (req) => {
    debug.requestFailed.push(
      `${req.failure()?.errorText || "FAILED"} ${req.method()} ${req.url()}`
    );
    if (debug.requestFailed.length > 20) debug.requestFailed.shift();
  });

  page.on("response", (res) => {
    const url = res.url();
    if (url.includes("mail.php")) {
      debug.responses.push(
        `${res.status()} ${url} ${res.headers().location ? "-> " + res.headers().location : ""}`
      );
      if (debug.responses.length > 10) debug.responses.shift();
    }
  });

  let stage = "start";

  try {
    stage = "goto";
    await page.goto(`${BASE_URL}/contacts.html`, { waitUntil: "domcontentloaded" });

    stage = "wait form";
    await page.waitForSelector("#contactForm", { visible: true });

    stage = "get action";
    const actionUrl = await page.$eval("#contactForm", (f) => f.action);
    const actionPath = new globalThis.URL(actionUrl).pathname;

    stage = "fill fields";
    await page.type('input[name="name"]', "Test User");
    await page.type('input[name="companyName"]', "Test Company");
    await page.type("#phone", "501234567");
    await page.type('input[name="email"]', "qa@test-company.example");
    await page.type('textarea[name="messageSend"]', "Automated form check message");

    await page.select('select[name="request"]', "Tech recruitment");
    await page.select('select[name="hear"]', "Google search");

    stage = "ensure honeypot empty";
    await page.evaluate(() => {
      const hp = document.querySelector('input[name="website"]');
      if (hp) hp.value = "";
    });

    // 1) Чекаємо token — тепер з чіткою помилкою
    stage = "wait token";
    try {
      await page.waitForFunction(
        () => document.querySelector("#token")?.value?.length > 0,
        { timeout: 45000 } // даємо капчі більше часу
      );
    } catch (e) {
      const tokenLen = await page.evaluate(() => (document.querySelector("#token")?.value || "").length);
      throw new Error(`Token was not set in time. tokenLen=${tokenLen}`);
    }

    // 2) Чекаємо, щоб fillTimeMs > 2500
    stage = "wait fillTime";
    await page.waitForTimeout(3200);

    // 3) Чекаємо response на mail.php
    stage = "submit + wait response";
    const resPromise = page.waitForResponse(
      (res) => {
        try {
          return new globalThis.URL(res.url()).pathname === actionPath;
        } catch {
          return false;
        }
      },
      { timeout: 45000 } // теж збільшили
    );

    await page.click("#contactSubmit");

    const res = await resPromise;
    const status = res.status();
    const location = res.headers().location || "";

    // Успіх: 2xx або 302 на thank-you
    const success =
      (status >= 200 && status < 300) ||
      (status === 302 && /thank-you-page\.html/i.test(location));

    const message = `${nowIso()} - ${success ? "✅ SUCCESS" : "❌ FAILED"} (HTTP ${status})${
      location ? ` -> ${location}` : ""
    }`;

    console.log(message);
    await sendEmail(success ? "✅ Form check result" : "❌ Form check failed", message);
  } catch (err) {
    // Збираємо більше контексту
    let url = "";
    let tokenLen = -1;
    try {
      url = page.url();
      tokenLen = await page.evaluate(() => (document.querySelector("#token")?.value || "").length);
    } catch (_) {}

    const details = [
      `${nowIso()} - ❌ ERROR at stage="${stage}": ${err.message}`,
      `URL: ${url}`,
      `tokenLen: ${tokenLen}`,
      debug.responses.length ? `mail.php responses: ${debug.responses.join(" | ")}` : "mail.php responses: (none)",
      debug.requestFailed.length ? `requestFailed: ${debug.requestFailed.join(" | ")}` : "requestFailed: (none)",
      debug.console.length ? `console: ${debug.console.join(" | ")}` : "console: (empty)",
    ].join("\n");

    console.error(details);
    await sendEmail("❌ Form check error", details);
  } finally {
    await browser.close();
  }
})();
