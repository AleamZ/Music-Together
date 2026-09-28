import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SecretBotStream, stepWithBots } from "@/lib/game/fight/bot";
import { createMatch, hash } from "@/lib/game/fight/engine";
import { decodeRuns, runsError } from "@/lib/game/fight/log";
import { PUSH_EVERY, RefereedMatch, ServerClock } from "@/lib/game/fight/referee";
import type { BotCase } from "@/scripts/gen-dojo-fixtures";
import { fixtureSeed, type SecretCase } from "@/scripts/gen-anticheat-v2-fixtures";

const CASES = JSON.parse(readFileSync("tests/fixtures/fight-bot-cases.json", "utf8")) as BotCase[];

describe("RefereedMatch (the client side of a refereed bot match)", () => {
  const c = CASES.find((x) => x.name === "exam-strong-style1-r0-l1")!;
  const masks = decodeRuns(c.runs, c.frames)!;

  it("never runs ahead of the clock, and waits for frame 0", () => {
    const m = new RefereedMatch(c.params, 10_000);
    expect(m.countdown(7_000)).toBe(3);
    expect(m.advance(9_000, 0)).toBe(0);
    expect(m.advance(10_000 + 1000, 0)).toBe(60);
    expect(m.advance(10_000 + 1000, 0)).toBe(0);
    expect(m.due(10_000 + 2500)).toBe(150);
  });

  it("replays the fixture to the server's hash, pushing 60-frame steps with their hashes", () => {
    const m = new RefereedMatch(c.params, 0);
    const pushes: { from: number; to: number; hashFrame: number | null }[] = [];
    let t = 0;
    for (let k = 0; k < masks.length; k++) {
      t = Math.ceil(((k + 1) * 1000) / 60);
      m.advance(t, masks[k], 1);
      const p = m.nextPush();
      if (p) {
        expect(runsError(p.runs, 300)).toBeNull();
        pushes.push({ from: p.from, to: p.to, hashFrame: p.hashFrame });
        m.pushDone(p.to - 1);
      }
    }
    expect(m.over).toBe(true);
    const last = m.nextPush();
    if (last) { pushes.push({ from: last.from, to: last.to, hashFrame: last.hashFrame }); m.pushDone(last.to - 1); }
    expect(hash(m.state)).toBe(c.expected.hash);
    expect(m.pushed).toBe(c.frames);
    expect(pushes.every((p, i) => p.from === (i === 0 ? 0 : pushes[i - 1].to))).toBe(true);
    expect(pushes.slice(0, -1).every((p) => p.to - p.from === PUSH_EVERY && p.hashFrame === p.to)).toBe(true);
    expect(m.runs()).toEqual(c.runs);
  });

  it("one push in flight at a time; a failed push is retried from the same frame", () => {
    const m = new RefereedMatch(c.params, 0);
    m.advance(3000, 0);
    const a = m.nextPush()!;
    expect(a.from).toBe(0);
    expect(m.nextPush()).toBeNull();
    m.pushFailed();
    const b = m.nextPush()!;
    expect(b.from).toBe(0);
    expect(b.to).toBe(180);
    m.pushDone(b.to - 1);
    expect(m.nextPush()).toBeNull();
    m.advance(4000, 0);
    expect(m.nextPush()).toMatchObject({ from: 180, to: 240, hashFrame: 240 });
  });

  it("procedure R: the server's sim plus my own frames past it gives my state", () => {
    const m = new RefereedMatch(c.params, 0);
    for (let k = 0; k < 400; k++) m.advance(Math.ceil(((k + 1) * 1000) / 60), masks[k], 1);
    let server = createMatch(c.params);
    for (let k = 0; k < 300; k++) server = stepWithBots(server, masks[k], 0);
    const before = hash(m.state);
    m.state = createMatch(c.params);                    // a broken local state
    m.resync(server, 300);
    expect(hash(m.state)).toBe(before);
  });
});

describe("RefereedMatch, a secret-bot match (0060)", () => {
  const secrets = JSON.parse(readFileSync("tests/fixtures/fight-secret-cases.json", "utf8")) as SecretCase[];
  const c = secrets[1];
  const masks = decodeRuns(c.runs, c.frames)!;

  it("sends no hash and, resynced from the server's sim at every push, ends on the server's state", () => {
    // the decoy stream differs from the server's (fixtureSeed): only the resyncs keep the display right
    const m = new RefereedMatch(c.params, 0, (r) => 99 * r + 1);
    const server = new SecretBotStream((r) => fixtureSeed(c.no, r));
    let s = createMatch(c.params);
    let at = 0;
    for (let k = 0; k < masks.length; k++) {
      m.advance(Math.ceil(((k + 1) * 1000) / 60), masks[k], 1);
      const p = m.nextPush();
      if (p) {
        expect(p.hash).toBeNull();
        expect(p.hashFrame).toBeNull();
        for (; at < p.to; at++) s = server.step(s, masks[at], 0);
        m.pushDone(p.to - 1);
        m.resync(s, at);
        expect(hash(m.state)).toBe(hash(s));
      }
    }
    expect(hash(s)).toBe(c.expected.hash);
  });

  it("the decoy never touches the state's G_RNG", () => {
    const m = new RefereedMatch(c.params, 0);
    for (let k = 0; k < 600; k++) m.advance(Math.ceil(((k + 1) * 1000) / 60), masks[k], 1);
    expect(m.state[5]).toBe(0);
    expect(m.secret).toBe(true);
  });
});

describe("ServerClock", () => {
  it("takes the median offset of the last five answers", () => {
    const c = new ServerClock();
    expect(c.now(100)).toBe(100);
    c.sample(1100, 0, 200);          // offset 1000
    c.sample(1500, 0, 200);          // 1400
    c.sample(900, 0, 0);             // 900
    expect(c.offset).toBe(1000);
    expect(c.now(0)).toBe(1000);
  });
});
