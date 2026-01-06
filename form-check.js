const puppeteer = require("puppeteer-core");
const nodemailer = require("nodemailer");

const URL = process.env.URL;

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

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  try {
    await page.goto(`${URL}/contacts.html`, { waitUntil: "networkidle2" });

    // ===== Identify form action (we'll wait for this response) =====
    await page.waitForSelector("#contactForm", { visible: true });
    const actionUrl = await page.$eval("#contactForm", (f) => f.action);

    // ===== Fill fields =====
    await page.waitForSelector("#name", { visible: true });
    await page.type("#name", "Test User");

    // companyName (у вашому JS читається getValue("companyName"))
    // Якщо id відрізняється — замініть на ваш реальний селектор.
    await page.waitForSelector('[name="companyName"]', { visible: true });
    await page.type('[name="companyName"]', "Test Company");

    await page.waitForSelector("#email", { visible: true });
    // корпоративний домен (НЕ з blacklist)
    await page.type("#email", "qa@test-company.example");

    await page.waitForSelector("#messageSend", { visible: true });
    await page.type("#messageSend", "Automated test submission");

    // Selects: важливо вибирати VALUE, а не текст.
    // Якщо у вас value інші — замініть.
    await page.waitForSelector("#request", { visible: true });
    await page.select("#request", "Tech recruitment");

    await page.waitForSelector("#hear", { visible: true });
    await page.select("#hear", "Google search");

    // Honeypot: website має бути пустим (ми нічого не заповнюємо)
    // Якщо поле існує і раптом autofill його заповнить — насильно очистимо:
    await page.evaluate(() => {
      const hp = document.querySelector('[name="website"]');
      if (hp) hp.value = "";
    });

    // ===== Wait for reCAPTCHA token =====
    await page.waitForFunction(
      () => document.querySelector("#token")?.value?.length > 0,
      { timeout: 15000 }
    );

    // ===== Important: wait so fillTimeMs > 2500ms (PHP filter) =====
    // Щоб не “впасти” на $fillTimeMs < 2500:
    await delay(3000);

    // ===== Submit and wait for fetch response =====
    const responsePromise = page.waitForResponse(
      (res) => res.url() === actionUrl,
      { timeout: 15000 }
    );

    await page.click("#contactSubmit");

    const res = await responsePromise;
    const ok = res.ok(); // status 200-299
    const status = res.status();

    const message = `${new Date().toISOString()} - ${
      ok ? "✅ SUCCESS" : "❌ FAILED"
    } (HTTP ${status})`;

    console.log(message);
    await sendEmail("✅ Form check result", message);
  } catch (err) {
    const message = `${new Date().toISOString()} - ❌ ERROR: ${err.message}`;
    console.error(message);
    await sendEmail("❌ Form check error", message);
  } finally {
    await browser.close();
  }
})();
