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

(async () => {
  console.log("FORM BOT VERSION: 2026-01-06 (contacts.html, fetch submit, anti-spam aware)");

  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  try {
    await page.goto(`${BASE_URL}/contacts.html`, { waitUntil: "networkidle2" });

    // Wait until form exists
    await page.waitForSelector("#contactForm", { visible: true });

    // Derive action path (absolute url)
    const actionUrl = await page.$eval("#contactForm", (f) => f.action);
    const actionPath = new globalThis.URL(actionUrl).pathname; // e.g. "/mail.php"

    // Fill fields (selectors match your markup)
    await page.waitForSelector('input[name="name"]', { visible: true });
    await page.type('input[name="name"]', "Test User");

    await page.waitForSelector('input[name="companyName"]', { visible: true });
    await page.type('input[name="companyName"]', "Test Company");

    await page.waitForSelector("#phone", { visible: true });
    await page.type("#phone", "501234567"); // any digits, intlTelInput will format number

    await page.waitForSelector('input[name="email"]', { visible: true });
    // Corporate email (not in blacklist)
    await page.type('input[name="email"]', "qa@test-company.example");

    await page.waitForSelector('textarea[name="messageSend"]', { visible: true });
    await page.type('textarea[name="messageSend"]', "Automated form check message");

    // Select values (your <option value="..."> are text values, so it's correct)
    await page.waitForSelector('select[name="request"]', { visible: true });
    await page.select('select[name="request"]', "Tech recruitment");

    await page.waitForSelector('select[name="hear"]', { visible: true });
    await page.select('select[name="hear"]', "Google search");

    // Ensure honeypot is empty (just in case)
    await page.evaluate(() => {
      const hp = document.querySelector('input[name="website"]');
      if (hp) hp.value = "";
    });

    // Wait for token to appear (your PHP requires it, and your JS sends it)
    await page.waitForFunction(
      () => document.querySelector("#token")?.value?.length > 0,
      { timeout: 20000 }
    );

    // IMPORTANT: ensure fillTimeMs > 2500ms (your backend filter)
    await page.waitForTimeout(3200);

    // Wait for fetch POST response to mail.php (no navigation)
    const resPromise = page.waitForResponse(
      (res) => {
        try {
          return new globalThis.URL(res.url()).pathname === actionPath;
        } catch {
          return false;
        }
      },
      { timeout: 20000 }
    );

    await page.click("#contactSubmit");

    const res = await resPromise;
    const status = res.status();
    const location = res.headers().location || "";

    // Consider 2xx and 3xx as "ok" (server might redirect http->https etc.)
    const success = status >= 200 && status < 400;

    const message = `${new Date().toISOString()} - ${
      success ? "✅ SUCCESS" : "❌ FAILED"
    } (HTTP ${status})${location ? ` -> ${location}` : ""}`;

    console.log(message);
    await sendEmail(success ? "✅ Form check result" : "❌ Form check failed", message);
  } catch (err) {
    const message = `${new Date().toISOString()} - ❌ ERROR: ${err.message}`;
    console.error(message);
    await sendEmail("❌ Form check error", message);
  } finally {
    await browser.close();
  }
})();
