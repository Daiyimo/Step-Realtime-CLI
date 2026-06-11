import { describe, it, expect } from "vitest";

// terminal-text.ts
import { sanitizeTerminalText } from "../terminal-text.js";

// shell.ts
import { enforceOutputLimit } from "../shell.js";

// path.ts
import {
  resolveInWorkspace,
  toWorkspaceRelative,
  expandHomeDirectory,
  resolveStorageRootDirectory,
} from "../path.js";
import path from "node:path";

// ─── sanitizeTerminalText ────────────────────────────────────────────────────

describe("sanitizeTerminalText", () => {
  it("strips ANSI color codes", () => {
    const input = "\u001b[31mred text\u001b[0m";
    expect(sanitizeTerminalText(input)).toBe("red text");
  });

  it("strips CSI cursor movement sequences", () => {
    const input = "hello\u001b[2Aworld";
    expect(sanitizeTerminalText(input)).toBe("helloworld");
  });

  it("strips OSC title sequences (BEL terminated)", () => {
    const input = "before\u001b]0;window-title\u0007after";
    expect(sanitizeTerminalText(input)).toBe("beforeafter");
  });

  it("strips OSC sequences (ST terminated)", () => {
    const input = "before\u001b]2;title\u001b\\after";
    expect(sanitizeTerminalText(input)).toBe("beforeafter");
  });

  it("strips DCS / SOS / PM / APC sequences (0x50/0x58/0x5e/0x5f)", () => {
    // DCS (0x50)
    expect(sanitizeTerminalText("a\u001bPdata\u001b\\b")).toBe("ab");
    // SOS (0x58)
    expect(sanitizeTerminalText("a\u001bXdata\u001b\\b")).toBe("ab");
    // PM (0x5e)
    expect(sanitizeTerminalText("a\u001b^data\u001b\\b")).toBe("ab");
    // APC (0x5f)
    expect(sanitizeTerminalText("a\u001b_data\u001b\\b")).toBe("ab");
  });

  it("strips SS2/SS3 two-byte sequences (0x4f/0x4e)", () => {
    // SS3 followed by a final byte
    expect(sanitizeTerminalText("a\u001bOAb")).toBe("ab");
    expect(sanitizeTerminalText("a\u001bNBb")).toBe("ab");
  });

  it("strips bare ESC followed by intermediate byte", () => {
    // ESC + byte in 0x30..0x7e range (single-char function)
    expect(sanitizeTerminalText("a\x1bcb")).toBe("ab");
  });

  it("strips carriage return", () => {
    expect(sanitizeTerminalText("hello\rworld")).toBe("helloworld");
  });

  it("strips other control characters (BEL, BS, etc.)", () => {
    expect(sanitizeTerminalText("a\u0007b")).toBe("ab"); // BEL
    expect(sanitizeTerminalText("a\u0008b")).toBe("ab"); // BS
    expect(sanitizeTerminalText("a\u0000b")).toBe("ab"); // NUL
    expect(sanitizeTerminalText("ab")).toBe("ab"); // DEL
  });

  it("preserves newlines by default", () => {
    expect(sanitizeTerminalText("hello\nworld")).toBe("hello\nworld");
  });

  it("strips newlines when preserveNewlines is false", () => {
    expect(
      sanitizeTerminalText("hello\nworld", { preserveNewlines: false }),
    ).toBe("helloworld");
  });

  it("preserves tabs by default", () => {
    expect(sanitizeTerminalText("hello\tworld")).toBe("hello\tworld");
  });

  it("strips tabs when preserveTabs is false", () => {
    expect(sanitizeTerminalText("hello\tworld", { preserveTabs: false })).toBe(
      "helloworld",
    );
  });

  it("handles emoji and multi-byte unicode correctly", () => {
    expect(sanitizeTerminalText("hello 🌍 world")).toBe("hello 🌍 world");
    expect(sanitizeTerminalText("\u001b[32m✅ ok\u001b[0m")).toBe("✅ ok");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeTerminalText("")).toBe("");
  });

  it("handles lone ESC at end of string", () => {
    expect(sanitizeTerminalText("hello\u001b")).toBe("hello");
  });

  it("handles incomplete CSI sequence at end of string", () => {
    expect(sanitizeTerminalText("hello\u001b[31")).toBe("hello");
  });

  it("passes through plain text unchanged", () => {
    const plain = "The quick brown fox jumps over the lazy dog.";
    expect(sanitizeTerminalText(plain)).toBe(plain);
  });
});

// ─── enforceOutputLimit (additional edge cases) ──────────────────────────────

describe("enforceOutputLimit", () => {
  it("returns value unchanged when within limit", () => {
    expect(enforceOutputLimit("short", 100)).toBe("short");
  });

  it("returns value unchanged when exactly at limit", () => {
    const s = "a".repeat(50);
    expect(enforceOutputLimit(s, 50)).toBe(s);
  });

  it("truncates with head+tail when over limit", () => {
    const s = "a".repeat(200);
    const result = enforceOutputLimit(s, 100);
    expect(result).toContain("[truncated");
    // head = 40% of limit = 40 chars, tail = 60% = 60 chars
    expect(result.startsWith("a".repeat(40))).toBe(true);
    expect(result.endsWith("a".repeat(60))).toBe(true);
  });

  it("handles limit of 0", () => {
    const result = enforceOutputLimit("hello", 0);
    expect(result).toContain("[truncated");
  });

  it("handles empty string", () => {
    expect(enforceOutputLimit("", 10)).toBe("");
  });

  it("handles single-char limit", () => {
    const result = enforceOutputLimit("abcdef", 1);
    expect(result).toContain("[truncated");
  });
});

// ─── resolveInWorkspace (security boundary) ──────────────────────────────────

describe("resolveInWorkspace", () => {
  const root = path.resolve("/workspace");

  it("resolves a simple relative path", () => {
    expect(resolveInWorkspace(root, "src/file.ts")).toBe(
      path.resolve(root, "src/file.ts"),
    );
  });

  it("resolves '.' as workspace root", () => {
    expect(resolveInWorkspace(root, ".")).toBe(root);
  });

  it("throws when path escapes workspace via ..", () => {
    expect(() => resolveInWorkspace(root, "../../etc/passwd")).toThrow(
      "Path escapes workspace root",
    );
  });

  it("throws on absolute path outside workspace", () => {
    expect(() => resolveInWorkspace(root, "/etc/passwd")).toThrow(
      "Path escapes workspace root",
    );
  });

  it("allows absolute path inside workspace", () => {
    expect(resolveInWorkspace(root, path.join(root, "src/file.ts"))).toBe(
      path.resolve(root, "src/file.ts"),
    );
  });

  it("allows nested .. that stays within workspace", () => {
    expect(resolveInWorkspace(root, "src/../lib/file.ts")).toBe(
      path.resolve(root, "lib/file.ts"),
    );
  });
});

// ─── toWorkspaceRelative ─────────────────────────────────────────────────────

describe("toWorkspaceRelative", () => {
  const root = path.resolve("/project");

  it("returns relative path for nested file", () => {
    expect(toWorkspaceRelative(root, path.resolve(root, "src/index.ts"))).toBe(
      path.join("src", "index.ts"),
    );
  });

  it("returns '.' for workspace root itself", () => {
    expect(toWorkspaceRelative(root, root)).toBe(".");
  });

  it("returns '.' for root with trailing slash", () => {
    // path.resolve normalizes trailing slashes away
    expect(toWorkspaceRelative(root, path.resolve(root))).toBe(".");
  });
});

// ─── expandHomeDirectory + resolveStorageRootDirectory (more edge cases) ─────

describe("expandHomeDirectory additional cases", () => {
  it("handles plain ~", () => {
    // Result should be the home directory (OS-dependent)
    const result = expandHomeDirectory("~");
    expect(result).not.toContain("~");
    expect(path.isAbsolute(result)).toBe(true);
  });

  it("handles ~/sub/dir", () => {
    const result = expandHomeDirectory("~/Documents");
    expect(result).not.toContain("~");
    expect(result).toMatch(/Documents$/);
  });

  it("does not expand ~otheruser", () => {
    expect(expandHomeDirectory("~otheruser")).toBe("~otheruser");
  });

  it("passes through regular absolute paths", () => {
    expect(expandHomeDirectory("/usr/local/bin")).toBe("/usr/local/bin");
  });
});

describe("resolveStorageRootDirectory additional cases", () => {
  it("resolves relative path against workspace", () => {
    const result = resolveStorageRootDirectory("/workspace", ".cache");
    expect(result).toBe(path.resolve("/workspace", ".cache"));
  });

  it("resolves ~-prefixed path to absolute", () => {
    const result = resolveStorageRootDirectory("/workspace", "~/data");
    expect(path.isAbsolute(result)).toBe(true);
    expect(result).not.toContain("~");
  });
});
