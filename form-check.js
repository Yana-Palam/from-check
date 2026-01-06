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

    // Form is present
    await page.waitForSelector("#contactForm", { visible: true });

    // Use form.action to match the fetch response (absolute URL)
    const actionUrl = await page.$eval("#contactForm", (f) => f.action);
    const actionPath = new URL(actionUrl).pathname; // e.g. "/mail.php"

    // Fill fields (selectors match your HTML)
    await page.waitForSelector('input[name="name"]', { visible: true });
    await page.type('input[name="name"]', "Test User");

    await page.waitForSelector('input[name="companyName"]', { visible: true });
    await page.type('input[name="companyName"]', "Test Company");

    await page.waitForSelector('input[name="email"]', { visible: true });
    await page.type('input[name="email"]', "qa@test-company.example");

    await page.waitForSelector('textarea[name="messageSend"]', { visible: true });
    await page.type('textarea[name="messageSend"]', "Automated test message");

    await page.waitForSelector('select[name="request"]', { visible: true });
    await page.select('select[name="request"]', "Tech recruitment");

    await page.waitForSelector('select[name="hear"]', { visible: true });
    await page.select('select[name="hear"]', "Google search");

    // Ensure honeypot is empty
    await page.evaluate(() => {
      const hp = document.querySelector('input[name="website"]');
      if (hp) hp.value = "";
    });

    // Wait for token (if your page sets it before submit)
    await page.waitForFunction(
      () => document.querySelector("#token")?.value?.length > 0,
      { timeout: 15000 }
    );

    // Avoid backend fillTimeMs filter (< 2500)
    await page.waitForTimeout(3000);

    // Wait for POST response to mail.php (fetch-based submit, no navigation)
    const responsePromise = page.waitForResponse(
      (res) => {
        try {
          return new URL(res.url()).pathname === actionPath;
        } catch {
          return false;
        }
      },
      { timeout: 20000 }
    );

    await page.click("#contactSubmit");

    const res = await responsePromise;
    const ok = res.ok();
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
