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

  const recipients = process.env.EMAIL_TO.split(",").map(e => e.trim());

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
    headless: "new",
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--enable-gpu",
      "--window-size=1366,768"
    ],
    defaultViewport: null,
  });

  const page = await browser.newPage();

  // 🟢 Маскуємо webdriver
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });

    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });

    Object.defineProperty(navigator, "platform", {
      get: () => "Win32",
    });
  });

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  await page.setViewport({
    width: 1366,
    height: 768,
  });

  await page.emulateTimezone("Europe/Kyiv");

  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  let stage = "start";

  try {
    stage = "goto";
    await page.goto(`${BASE_URL}/contacts.html`, {
      waitUntil: "networkidle2",
    });

    stage = "human move mouse";
    await page.mouse.move(100, 200);
    await page.waitForTimeout(800);
    await page.mouse.move(300, 400);
    await page.waitForTimeout(1200);

    stage = "wait form";
    await page.waitForSelector("#contactForm", { visible: true });

    stage = "fill slowly";

    await page.type('input[name="name"]', "Test User", { delay: 120 });
    await page.waitForTimeout(500);

    await page.type('input[name="companyName"]', "Test Company", { delay: 120 });
    await page.waitForTimeout(600);

    await page.type("#phone", "501234567", { delay: 100 });
    await page.waitForTimeout(600);

    await page.type('input[name="email"]', "qa@test-company.example", { delay: 120 });
    await page.waitForTimeout(700);

    await page.select('select[name="request"]', "Tech recruitment");
    await page.waitForTimeout(600);

    await page.select('select[name="hear"]', "Google search");
    await page.waitForTimeout(600);

    await page.type(
      'textarea[name="messageSend"]',
      "Automated form check message",
      { delay: 80 }
    );

    // Дати reCAPTCHA більше часу
    await page.waitForTimeout(8000);

    stage = "wait token";
    await page.waitForFunction(
      () => document.querySelector("#token")?.value?.length > 0,
      { timeout: 60000 }
    );

    stage = "submit";

    const actionUrl = await page.$eval("#contactForm", f => f.action);
    const actionPath = new URL(actionUrl).pathname;

    const resPromise = page.waitForResponse(
      res => {
        try {
          return new URL(res.url()).pathname === actionPath;
        } catch {
          return false;
        }
      },
      { timeout: 60000 }
    );

    await page.click("#contactSubmit");

    const res = await resPromise;
    const status = res.status();

    const success = status >= 200 && status < 400;

    const message = `${nowIso()} - ${
      success ? "✅ SUCCESS" : "❌ FAILED"
    } (HTTP ${status})`;

    await sendEmail(
      success ? "✅ Form check result" : "❌ Form check failed",
      message
    );
  } catch (err) {
    const details = `${nowIso()} - ❌ ERROR at stage="${stage}": ${err.message}`;
    await sendEmail("❌ Form check error", details);
  } finally {
    await browser.close();
  }
})();
