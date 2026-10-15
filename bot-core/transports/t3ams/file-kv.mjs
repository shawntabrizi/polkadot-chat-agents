// SPDX-License-Identifier: GPL-3.0-or-later

// The bot's host key-value store: everything the T3ams app persists — the
// session, workspaces, message history (sealed) and the MLS keystore — lives
// here, one file per key under the bot's state directory. Writes go to a temp
// file, are fsynced and renamed into place, so a crash leaves either the old
// value or the new one. Keys are hashed into file names; the key itself is
// stored alongside the value so the directory stays inspectable.
//
// Shape: `HostLocalStorage` from @parity/product-sdk-host.

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const fileName = (key) => createHash("sha256").update(key).digest("hex");

/** @param {string} directory */
export function createT3amsFileKv(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const pathOf = (key) => path.join(directory, fileName(key));

  const read = (key) => {
    try {
      return JSON.parse(fs.readFileSync(pathOf(key), "utf8")).value;
    } catch (error) {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    }
  };

  const write = (key, value) => {
    const target = pathOf(key);
    const temp = `${target}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temp, "w", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({ key, value }));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, target);
  };

  return {
    async readString(key) {
      return read(key) ?? "";
    },
    async writeString(key, value) {
      write(key, String(value));
    },
    async readJSON(key) {
      const raw = read(key);
      return raw == null ? null : JSON.parse(raw);
    },
    async writeJSON(key, value) {
      write(key, JSON.stringify(value));
    },
    async readBytes(key) {
      const raw = read(key);
      return raw == null ? undefined : new Uint8Array(Buffer.from(raw, "base64"));
    },
    async writeBytes(key, value) {
      write(key, Buffer.from(value).toString("base64"));
    },
    async clear(key) {
      fs.rmSync(pathOf(key), { force: true });
    },
  };
}
