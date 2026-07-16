import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { INITIAL_ITEMS } from "../../src/server/db/seed";

const PAYLOAD_HASHES = {
  "ko-01": "add18e0a89b8d54bf5ffbbf9190fad68f3a6b4ee20647dbdc48997221b2ed694",
  "ko-02": "3f12ea37e1869eee983f3a60655de2f6889901184456e761c4afef4312aeca36",
  "ko-03": "24f6828631b9d87986cd4069e85507315b3df40b9d4c84a9e3796c51ad1c9c68",
  "ko-04": "6336aa769b4376a04de6ede7ac4609a963a517039b1509ca313be75154a88a58",
  "ko-05": "1a7f8af228f81c9328ee0158e4ad2bf4ccffa080dea70170b2e0efe83ac3aa64",
  "ko-06": "05a204a0d11d60fcaa8c2d35902c05d2895876ff93b0f176ad3ef8b62b19baca",
  "ko-07": "eb6dcb59483dd5bfc3813720f8f91009aa1f9d2d62c592557ab0a5f213587d66",
  "ko-08": "dab4528141397e4f30d022159037d0258515825b8398d4963114c86db744748a",
  "ko-09": "80f0837782393ab7c4e9e2eade6b22dba14432382301dbf11f0c8a2df58b2b23",
  "ko-10": "5c7df0653e562753f199772b400e8266d4ae5868671778fdec8eca6f4b610b25",
  "math-01": "0ada28fab5aaa1fd857e28f1016888d073cb47689944b9a8e0da039e1cdf45ec",
  "math-02": "bee95fc4e89ede4a4f6eee196aa6a1ea4551f333f48fe6a12654552bab1aacb4",
  "math-03": "c7c874195b14ee19d2281e5b63a858496531dcdae1628bae838b6c8c4e83c05e",
  "math-04": "32c400e326f512abda82b05900eaf3e31aabd1eb27a346cdd3c709639357527d",
  "math-05": "7bb684c418a1a223b66e4f6e97041e717c9c66b5ee42b5dd41d68b72ffdb8ff6",
  "math-06": "9ec4d1c6ff5a993f64fc16be57befda4187b386133da91934609ea6b71247701",
  "math-07": "c6532946ac828bf7dde484a5ef31a04df48d0a049b1e4258b3a2f05811e7e780",
  "math-08": "5a3aef20f32997e80dca6280aae4e348b663ad878a779ee9203bd79009c3565b",
  "math-09": "3f2de65a6fe0b391b3b492fd50ad5794716de06760b2505dcb6f1ca940f3413b",
  "math-10": "91fd61fb875ea1c03e20e08a3f4cc299cd9ce1b31ba0dfcbd944c3077d074f70"
} as const;

const ICON_HASHES = {
  "apple-touch-icon.png": "f596d9540331a5203c2355eac41ed00b47a3e5c610ae09865a269f52305a6664",
  "icon-192.png": "c5c8d5cc37e0bb7964ce1914c1fe858a048454d7a0d84338693b944bd1629505",
  "icon-512.png": "310f185a0b3493e47f08dd2134bd7709276fc364cee95400d72a021f3903313b",
  "study-desk.png": "7f88d5d04ead8d5bc1854d14d1d19702c089e122f836dafdbfa37edf9bb0cd2d"
} as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("retired prototype parity manifest", () => {
  it("preserves all 20 normalized learning payload hashes", () => {
    const actual = Object.fromEntries(INITIAL_ITEMS.map((item) => [
      item.id,
      sha256(canonical(item))
    ]));

    expect(INITIAL_ITEMS).toHaveLength(20);
    expect(actual).toEqual(PAYLOAD_HASHES);
  });

  it("preserves every migrated prototype icon hash", async () => {
    const actual = Object.fromEntries(await Promise.all(
      Object.keys(ICON_HASHES).map(async (filename) => [
        filename,
        sha256(await readFile(resolve("public/assets", filename)))
      ])
    ));

    expect(actual).toEqual(ICON_HASHES);
  });
});
