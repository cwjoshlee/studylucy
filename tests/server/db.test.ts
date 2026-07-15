import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/server/db/client";
import { migrate } from "../../src/server/db/migrate";
import { seedInitialContent } from "../../src/server/db/seed";

describe("database bootstrap", () => {
  const db = openDatabase(":memory:");

  afterEach(() => db.exec("DELETE FROM attempts; DELETE FROM content_versions; DELETE FROM content_items;"));

  it("runs migrations idempotently", () => {
    migrate(db);
    migrate(db);

    expect(db.prepare("select count(*) as count from schema_migrations").get())
      .toEqual({ count: 2 });
  });

  it("seeds the exact ten Korean and ten math items", () => {
    migrate(db);
    seedInitialContent(db);
    seedInitialContent(db);

    const rows = db.prepare("select subject, count(*) as count from content_items group by subject order by subject").all();
    expect(rows).toEqual([
      { subject: "korean", count: 10 },
      { subject: "math", count: 10 }
    ]);
  });
});
