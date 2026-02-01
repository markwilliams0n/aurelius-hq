import { config } from "dotenv";
config({ path: ".env.local" });

import * as fs from "fs";
import * as path from "path";

async function seed() {
  // Dynamic import after dotenv has loaded
  const { db } = await import("./index");
  const { configs, users } = await import("./schema");
  const { eq } = await import("drizzle-orm");

  console.log("Seeding database...");

  // Seed configs
  const configFiles = ["soul", "agents", "processes"] as const;

  for (const key of configFiles) {
    const filePath = path.join(process.cwd(), "seed", `${key}.md`);
    const content = fs.readFileSync(filePath, "utf-8");

    // Check if config exists
    const existing = await db
      .select()
      .from(configs)
      .where(eq(configs.key, key))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(configs).values({
        key,
        content,
        version: 1,
        createdBy: "system",
      });
      console.log(`Created config: ${key}`);
    } else {
      console.log(`Config already exists: ${key}`);
    }
  }

  // Seed admin user if ADMIN_EMAIL is set
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, adminEmail))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(users).values({ email: adminEmail });
      console.log(`Created admin user: ${adminEmail}`);
    } else {
      console.log(`Admin user already exists: ${adminEmail}`);
    }
  }

  console.log("Seeding complete!");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  });
