const puppeteer = require("puppeteer-core");
const nodemailer = require("nodemailer");

const URL = process.env.URL;

async function sendEmail(subject, text) {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: Number(process.env.EMAIL_PORT) === 465, // true для 465, false для 587
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const recipients = process.env.EMAIL_TO.split(",").map((email) =>
    email.trim()
  );

  await transporter.sendMail({
    from: `"Form Bot" <${process.env.EMAIL_USER}>`,
    to: recipients,
    subject,
    text,
  });
}

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

    await page.waitForSelector("#name", { visible: true });
    await page.type("#name", "Test User");

    await page.waitForSelector("#company", { visible: true });
    await page.type("#company", "Test Company");

    await page.waitForSelector("#email", { visible: true });
    await page.type("#email", "test@example.com");

    await page.waitForSelector("#messageSend", { visible: true });
    await page.type("#messageSend", "This is a test message");

    await page.waitForSelector("#request", { visible: true });
    await page.select("#request", "Tech recruitment");

    await page.waitForSelector("#hear", { visible: true });
    await page.select("#hear", "Google search");

    await page.evaluate(() => {
      const consent = document.querySelector("#consent");
      if (consent) consent.checked = true;
    });

    await page.waitForFunction(
      () => {
        return document.querySelector("#token")?.value?.length > 0;
      },
      { timeout: 10000 }
    );

    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "networkidle0", timeout: 10000 })
        .catch(() => {}),
      page.click("#submitButton"),
    ]);

    const success = page.url().includes("/thank-you-page");
    const message = `${new Date().toISOString()} - ${
      success ? "✅ SUCCESS" : "❌ FAILED"
    }`;

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
