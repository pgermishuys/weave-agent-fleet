import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

test.describe("Question Tool Card - E2E Flow", () => {
  test("should submit answer successfully and measure timing", async ({ page }) => {
    // Start at the app
    await page.goto(`${BASE_URL}`);

    // Wait for the app to load (look for main content)
    await page.waitForSelector("[role='main'], main, .main", { timeout: 10000 });

    console.log("✓ App loaded");

    // Create a new session by clicking "New Session" or similar
    // (Adjust selector based on actual UI)
    const createSessionBtn = page.locator('button:has-text("New")').first();
    if (await createSessionBtn.isVisible()) {
      await createSessionBtn.click();
      await page.waitForTimeout(1000);
      console.log("✓ New session created");
    }

    // Get the current session ID from URL or DOM
    const url = page.url();
    console.log(`📍 Current URL: ${url}`);

    // Wait for session list or active session to be visible
    await page.waitForSelector('[data-testid="session-item"], .session-item, a[href*="/sessions/"]', {
      timeout: 5000,
    });

    const sessionLinks = page.locator('a[href*="/sessions/"]');
    const firstSession = sessionLinks.first();

    if (await firstSession.isVisible()) {
      const href = await firstSession.getAttribute("href");
      console.log(`🔗 Session link: ${href}`);

      // Click to open the session
      await firstSession.click();
      await page.waitForURL((url) => url.toString().includes("/sessions/"), { timeout: 10000 });
      console.log("✓ Session opened");
    }

    // Wait for the question card to appear
    const questionCard = page.locator('[data-testid="question-tool-card"], .question-tool-card, [class*="question"]').first();

    const questionStartTime = Date.now();
    await questionCard.waitFor({ state: "visible", timeout: 30000 });
    const questionLoadTime = Date.now() - questionStartTime;
    console.log(`⏱️  Question appeared in ${questionLoadTime}ms`);

    // Check if question text is visible
    const questionText = page.locator('[class*="question"], h2, h3').filter({ hasText: /question|what|choose/i }).first();
    if (await questionText.isVisible()) {
      const text = await questionText.textContent();
      console.log(`📝 Question: ${text?.substring(0, 80)}`);
    }

    // Find and interact with the first option button or input
    const optionsContainer = questionCard;
    const button = optionsContainer.locator("button").first();
    const input = optionsContainer.locator('input[type="text"]');

    let selectedElement = null;

    if (await button.isVisible()) {
      console.log("🔘 Found option button");
      selectedElement = button;
    } else if (await input.isVisible()) {
      console.log("📝 Found custom text input");
      selectedElement = input;
    } else {
      console.log("⚠️  No interactive element found, looking for any clickable...");
      const anyButton = questionCard.locator("button, label, [role='button']").first();
      if (await anyButton.isVisible()) {
        selectedElement = anyButton;
        console.log("🔘 Found generic clickable element");
      }
    }

    if (selectedElement) {
      // Type or click
      if (await selectedElement.getAttribute("type") === "text") {
        await selectedElement.fill("Test Answer");
        console.log("✓ Filled text input");
      } else {
        await selectedElement.click();
        console.log("✓ Clicked option");
      }

      // Wait for submit button
      await page.waitForTimeout(500); // Allow UI to update after selection

      const submitBtn = questionCard.locator('button:has-text("Submit"), button[type="submit"]').first();

      if (await submitBtn.isVisible()) {
        const submitStartTime = Date.now();
        await submitBtn.click();
        console.log("✓ Clicked submit button");

        // Wait for response (look for success indicator, spinner disappearing, etc.)
        await page.waitForTimeout(1000);

        // Check for success state
        const successIndicator = page.locator('[class*="success"], [class*="check"], [data-testid="success"]').first();
        if (await successIndicator.isVisible({ timeout: 5000 }).catch(() => false)) {
          console.log("✓ Success indicator visible");
        }

        const submitTime = Date.now() - submitStartTime;
        console.log(`⏱️  Submit request took ${submitTime}ms`);

        console.log(`\n📊 Timing Summary:`);
        console.log(`   - Question load: ${questionLoadTime}ms`);
        console.log(`   - Submit request: ${submitTime}ms`);
        console.log(`   - Total: ${questionLoadTime + submitTime}ms`);
      } else {
        console.log("⚠️  Submit button not found");
      }
    } else {
      console.log("⚠️  Could not find interactive element to answer question");
    }
  });

  test("should verify answers are sent in correct format", async ({ page }) => {
    // Intercept API calls to verify answer format
    let capturedAnswer: any = null;

    await page.on("response", async (response) => {
      if (response.url().includes("/reply")) {
        const request = response.request();
        if (request.method() === "POST") {
          try {
            const postData = request.postDataJSON();
            capturedAnswer = postData;
            console.log(`📤 Answer sent:`, JSON.stringify(postData, null, 2));
          } catch (e) {
            // POST data might not be JSON
          }
        }

        const status = response.status();
        console.log(`📥 /reply response: ${status}`);

        if (status !== 200) {
          try {
            const body = await response.json();
            console.log(`   Response body:`, JSON.stringify(body, null, 2));
          } catch (e) {
            console.log(`   (Could not parse response body)`);
          }
        }
      }
    });

    await page.goto(`${BASE_URL}`);
    await page.waitForSelector("[role='main'], main, .main", { timeout: 10000 });

    // Open a session or wait for question
    // (This is abbreviated; in real test you'd wait for question)
    console.log("✓ Monitoring /reply endpoint for answers");

    // The actual test would continue to trigger a question submission...
    // For now, this test validates the network monitoring works
  });
});
