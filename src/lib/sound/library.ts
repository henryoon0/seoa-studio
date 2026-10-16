/*
 * 소리 레시피 원장. 오디오 파일은 하나도 없다 — 각 항목은 "어떤 파형을, 어느
 * 주파수에서, 얼마나 빨리 감쇠시켜라"라는 설명서이고 synth.ts가 브라우저에서
 * 그 자리에서 연주한다.
 *
 * 출처: procedural-sounds (https://github.com/m1ckc3s/procedural-sounds)
 * data/reference/reference-sounds.json 의 core/minimal/soft/crisp 테마.
 * MIT License — ./NOTICE.md 참고. 손으로 고치지 말고 그 저장소에서 다시 뽑을 것.
 */

import type { Patch } from "./patch";

/** core 테마가 가진 전체 소리 이름. 다른 테마는 이 중 일부만 가진다. */
export const SOUND_NAMES = [
  "click",
  "tap",
  "key-press",
  "checkbox",
  "radio",
  "tick",
  "scroll-snap",
  "focus",
  "blur",
  "toggle-on",
  "toggle-off",
  "hover",
  "select",
  "deselect",
  "pop",
  "boop",
  "bounce",
  "spring",
  "expand",
  "collapse",
  "success",
  "complete",
  "level-up",
  "confetti",
  "save",
  "ding",
  "notification",
  "mention",
  "badge",
  "info",
  "sparkle",
  "star",
  "error",
  "delete",
  "warning",
  "swoosh",
  "whoosh",
  "page-enter",
  "page-exit",
  "tab-switch",
  "drawer-open",
  "drawer-close",
  "modal-open",
  "modal-close",
  "dropdown-open",
  "dropdown-close",
  "slide",
  "slide-up",
  "slide-down",
  "copy",
  "send",
  "receive",
  "command",
  "escape",
  "undo",
  "archive",
  "sync",
  "heart",
  "streak",
  "loading-start",
  "loading-end",
  "progress-tick",
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

export type SoundTheme = "core" | "minimal" | "soft" | "crisp";

export const SOUND_THEMES: ReadonlyArray<{ id: SoundTheme; label: string; description: string }> = [
  { id: "core", label: "\uae30\ubcf8", description: "\ub610\ub837\ud558\uace0 \uc775\uc219\ud55c \uae30\ubcf8 \ud329. \ubaa8\ub4e0 \uc18c\ub9ac \uc774\ub984\uc744 \ub2e4 \uac00\uc9c0\uace0 \uc788\ub2e4." },
  { id: "minimal", label: "\ubbf8\ub2c8\uba40", description: "\uac00\uc7a5 \uc9e7\uace0 \uc870\uc6a9\ud55c \ud1a4. \uc18c\ub9ac\uac00 \uc788\ub294 \uc904\ub3c4 \ubaa8\ub974\uac8c." },
  { id: "soft", label: "\ubd80\ub4dc\ub7fd\uac8c", description: "\ub465\uae00\uace0 \ub0ae\uc740 \ud1a4. \uc624\ub798 \ucf1c\ub450\uae30 \ud3b8\ud558\ub2e4." },
  { id: "crisp", label: "\ub610\ub837\ud558\uac8c", description: "\ubc1d\uace0 \ub0a0\uce74\ub85c\uc6b4 \ud1a4. \ubc18\uc751\uc774 \ud655\uc2e4\ud558\uac8c \ub290\uaef4\uc9c4\ub2e4." },
];

type ThemePatches = Partial<Record<SoundName, Patch>>;

export const SOUND_LIBRARY: Record<SoundTheme, ThemePatches> = {
  core: {
    "click": {
      source: {
        type: "sine",
        frequency: {
          start: 200,
          end: 700,
        },
        fm: {
          ratio: 0.5,
          depth: 80,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.06,
        sustain: 0,
        release: 0.02,
      },
      gain: 0.25,
    },
    "tap": {
      source: {
        type: "sine",
        frequency: 1300,
        fm: {
          ratio: 0.5,
          depth: 100,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.015,
        sustain: 0,
        release: 0.005,
      },
      gain: 0.2,
    },
    "key-press": {
      source: {
        type: "sine",
        frequency: 1300,
        fm: {
          ratio: 0.5,
          depth: 80,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.012,
        sustain: 0,
        release: 0.004,
      },
      gain: 0.18,
    },
    "checkbox": {
      source: {
        type: "sine",
        frequency: {
          start: 250,
          end: 800,
        },
        fm: {
          ratio: 0.5,
          depth: 60,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.05,
        sustain: 0,
        release: 0.015,
      },
      gain: 0.22,
    },
    "radio": {
      source: {
        type: "sine",
        frequency: {
          start: 300,
          end: 900,
        },
        fm: {
          ratio: 0.5,
          depth: 50,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.04,
        sustain: 0,
        release: 0.012,
      },
      gain: 0.2,
    },
    "tick": {
      source: {
        type: "sine",
        frequency: 1500,
        fm: {
          ratio: 0.5,
          depth: 60,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.01,
        sustain: 0,
        release: 0.004,
      },
      gain: 0.15,
    },
    "scroll-snap": {
      source: {
        type: "sine",
        frequency: 1400,
        fm: {
          ratio: 0.5,
          depth: 50,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.008,
        sustain: 0,
        release: 0.003,
      },
      gain: 0.08,
    },
    "focus": {
      source: {
        type: "sine",
        frequency: 1300,
        fm: {
          ratio: 0.5,
          depth: 40,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.02,
        sustain: 0,
        release: 0.008,
      },
      gain: 0.06,
    },
    "blur": {
      source: {
        type: "sine",
        frequency: 1100,
        fm: {
          ratio: 0.5,
          depth: 30,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.018,
        sustain: 0,
        release: 0.008,
      },
      gain: 0.04,
    },
    "toggle-on": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 2093,
          },
          envelope: {
            attack: 0,
            decay: 0.012,
            sustain: 0,
            release: 0.004,
          },
          gain: 0.2,
        },
        {
          source: {
            type: "sine",
            frequency: 3136,
          },
          envelope: {
            attack: 0,
            decay: 0.012,
            sustain: 0,
            release: 0.004,
          },
          delay: 0.025,
          gain: 0.2,
        },
      ],
    },
    "toggle-off": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 2219,
          },
          envelope: {
            attack: 0,
            decay: 0.012,
            sustain: 0,
            release: 0.004,
          },
          gain: 0.2,
        },
        {
          source: {
            type: "sine",
            frequency: 2093,
          },
          envelope: {
            attack: 0,
            decay: 0.012,
            sustain: 0,
            release: 0.004,
          },
          delay: 0.025,
          gain: 0.2,
        },
      ],
    },
    "hover": {
      source: {
        type: "sine",
        frequency: 1300,
      },
      envelope: {
        attack: 0.005,
        decay: 0.015,
        sustain: 0,
        release: 0.008,
      },
      gain: 0.04,
    },
    "select": {
      source: {
        type: "sine",
        frequency: 1400,
        fm: {
          ratio: 0.5,
          depth: 60,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.05,
        sustain: 0,
        release: 0.015,
      },
      gain: 0.2,
    },
    "deselect": {
      source: {
        type: "sine",
        frequency: 1200,
        fm: {
          ratio: 0.5,
          depth: 60,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.04,
        sustain: 0,
        release: 0.012,
      },
      gain: 0.16,
    },
    "pop": {
      source: {
        type: "sine",
        frequency: {
          start: 400,
          end: 150,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.08,
        sustain: 0,
        release: 0.025,
      },
      gain: 0.25,
    },
    "boop": {
      source: {
        type: "sine",
        frequency: {
          start: 600,
          end: 250,
        },
        fm: {
          ratio: 0.5,
          depth: 40,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.1,
        sustain: 0,
        release: 0.03,
      },
      gain: 0.2,
    },
    "bounce": {
      source: {
        type: "sine",
        frequency: {
          start: 350,
          end: 180,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.12,
        sustain: 0,
        release: 0.04,
      },
      gain: 0.22,
    },
    "spring": {
      source: {
        type: "sine",
        frequency: {
          start: 400,
          end: 900,
        },
        fm: {
          ratio: 0.5,
          depth: 50,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.15,
        sustain: 0.03,
        release: 0.05,
      },
      gain: 0.18,
    },
    "expand": {
      source: {
        type: "sine",
        frequency: {
          start: 500,
          end: 700,
        },
      },
      envelope: {
        attack: 0.003,
        decay: 0.1,
        sustain: 0.02,
        release: 0.04,
      },
      gain: 0.12,
    },
    "collapse": {
      source: {
        type: "sine",
        frequency: {
          start: 700,
          end: 500,
        },
      },
      envelope: {
        attack: 0.003,
        decay: 0.1,
        sustain: 0.02,
        release: 0.04,
      },
      gain: 0.12,
    },
    "success": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 523,
          },
          envelope: {
            attack: 0.003,
            decay: 0.3,
            sustain: 0.06,
            release: 0.1,
          },
          gain: 0.16,
        },
        {
          source: {
            type: "sine",
            frequency: 659,
          },
          envelope: {
            attack: 0.003,
            decay: 0.28,
            sustain: 0.05,
            release: 0.1,
          },
          delay: 0.07,
          gain: 0.14,
        },
        {
          source: {
            type: "sine",
            frequency: {
              start: 784,
              end: 880,
            },
          },
          envelope: {
            attack: 0.003,
            decay: 0.32,
            sustain: 0.06,
            release: 0.12,
          },
          delay: 0.14,
          gain: 0.15,
        },
      ],
    },
    "complete": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 523,
          },
          envelope: {
            attack: 0.003,
            decay: 0.35,
            sustain: 0.05,
            release: 0.1,
          },
          gain: 0.15,
        },
        {
          source: {
            type: "sine",
            frequency: 659,
          },
          envelope: {
            attack: 0.003,
            decay: 0.35,
            sustain: 0.05,
            release: 0.1,
          },
          delay: 0.015,
          gain: 0.13,
        },
        {
          source: {
            type: "sine",
            frequency: 784,
          },
          envelope: {
            attack: 0.003,
            decay: 0.35,
            sustain: 0.05,
            release: 0.1,
          },
          delay: 0.03,
          gain: 0.12,
        },
        {
          source: {
            type: "sine",
            frequency: {
              start: 1046,
              end: 1175,
            },
          },
          envelope: {
            attack: 0.003,
            decay: 0.3,
            sustain: 0.04,
            release: 0.12,
          },
          delay: 0.045,
          gain: 0.1,
        },
      ],
    },
    "level-up": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 440,
          },
          envelope: {
            attack: 0.003,
            decay: 0.25,
            sustain: 0.06,
            release: 0.1,
          },
          gain: 0.15,
        },
        {
          source: {
            type: "sine",
            frequency: 554,
          },
          envelope: {
            attack: 0.003,
            decay: 0.25,
            sustain: 0.05,
            release: 0.1,
          },
          delay: 0.07,
          gain: 0.14,
        },
        {
          source: {
            type: "sine",
            frequency: 660,
          },
          envelope: {
            attack: 0.003,
            decay: 0.28,
            sustain: 0.05,
            release: 0.1,
          },
          delay: 0.14,
          gain: 0.13,
        },
        {
          source: {
            type: "sine",
            frequency: {
              start: 880,
              end: 990,
            },
          },
          envelope: {
            attack: 0.003,
            decay: 0.22,
            sustain: 0.04,
            release: 0.12,
          },
          delay: 0.21,
          gain: 0.08,
        },
      ],
    },
    "confetti": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 523,
          },
          envelope: {
            attack: 0.002,
            decay: 0.18,
            sustain: 0.04,
            release: 0.08,
          },
          gain: 0.14,
        },
        {
          source: {
            type: "sine",
            frequency: 659,
          },
          envelope: {
            attack: 0.002,
            decay: 0.18,
            sustain: 0.04,
            release: 0.08,
          },
          delay: 0.06,
          gain: 0.14,
        },
        {
          source: {
            type: "sine",
            frequency: 784,
          },
          envelope: {
            attack: 0.002,
            decay: 0.18,
            sustain: 0.03,
            release: 0.08,
          },
          delay: 0.12,
          gain: 0.12,
        },
        {
          source: {
            type: "sine",
            frequency: {
              start: 1047,
              end: 1175,
            },
          },
          envelope: {
            attack: 0.002,
            decay: 0.2,
            sustain: 0.03,
            release: 0.1,
          },
          delay: 0.18,
          gain: 0.1,
        },
      ],
    },
    "save": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: {
              start: 880,
              end: 1046,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.1,
            sustain: 0.03,
            release: 0.04,
          },
          gain: 0.14,
        },
        {
          source: {
            type: "sine",
            frequency: {
              start: 1046,
              end: 1175,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.1,
            sustain: 0.02,
            release: 0.04,
          },
          delay: 0.08,
          gain: 0.1,
        },
      ],
    },
    "ding": {
      source: {
        type: "sine",
        frequency: 880,
        fm: {
          ratio: 3.5,
          depth: 300,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.6,
        sustain: 0.04,
        release: 0.25,
      },
      effects: [
        {
          type: "reverb",
          decay: 0.8,
          damping: 0.6,
          mix: 0.15,
        },
      ],
      gain: 0.18,
    },
    "notification": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 780,
            fm: {
              ratio: 1.5,
              depth: 150,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.4,
            sustain: 0.04,
            release: 0.15,
          },
          effects: [
            {
              type: "reverb",
              decay: 0.6,
              damping: 0.6,
              mix: 0.12,
            },
          ],
          gain: 0.16,
        },
        {
          source: {
            type: "sine",
            frequency: 1170,
            fm: {
              ratio: 1.5,
              depth: 120,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.35,
            sustain: 0.03,
            release: 0.15,
          },
          delay: 0.1,
          effects: [
            {
              type: "reverb",
              decay: 0.6,
              damping: 0.6,
              mix: 0.12,
            },
          ],
          gain: 0.14,
        },
      ],
    },
    "mention": {
      source: {
        type: "sine",
        frequency: 660,
        fm: {
          ratio: 2.5,
          depth: 150,
        },
      },
      envelope: {
        attack: 0.003,
        decay: 0.5,
        sustain: 0.05,
        release: 0.2,
      },
      effects: [
        {
          type: "reverb",
          decay: 0.6,
          damping: 0.5,
          mix: 0.1,
        },
      ],
      gain: 0.14,
    },
    "badge": {
      source: {
        type: "sine",
        frequency: 1100,
        fm: {
          ratio: 2.76,
          depth: 350,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.35,
        sustain: 0.04,
        release: 0.15,
      },
      effects: [
        {
          type: "reverb",
          decay: 0.5,
          damping: 0.6,
          mix: 0.1,
        },
      ],
      gain: 0.16,
    },
    "info": {
      source: {
        type: "sine",
        frequency: 880,
        fm: {
          ratio: 2,
          depth: 120,
        },
      },
      envelope: {
        attack: 0.003,
        decay: 0.3,
        sustain: 0.04,
        release: 0.12,
      },
      gain: 0.14,
    },
    "sparkle": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 1047,
            detune: 7,
            fm: {
              ratio: 3.5,
              depth: 200,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.4,
            sustain: 0.04,
            release: 0.18,
          },
          effects: [
            {
              type: "reverb",
              decay: 0.8,
              damping: 0.5,
              mix: 0.15,
            },
          ],
          gain: 0.12,
        },
        {
          source: {
            type: "sine",
            frequency: 1050,
            fm: {
              ratio: 3.5,
              depth: 180,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.38,
            sustain: 0.03,
            release: 0.18,
          },
          gain: 0.08,
        },
      ],
    },
    "star": {
      source: {
        type: "sine",
        frequency: 880,
        fm: {
          ratio: 2.76,
          depth: 250,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.4,
        sustain: 0.04,
        release: 0.18,
      },
      effects: [
        {
          type: "reverb",
          decay: 0.6,
          damping: 0.5,
          mix: 0.12,
        },
      ],
      gain: 0.14,
    },
    "error": {
      layers: [
        {
          source: {
            type: "sawtooth",
            frequency: {
              start: 320,
              end: 140,
            },
          },
          filter: {
            type: "lowpass",
            frequency: 1200,
          },
          envelope: {
            attack: 0,
            decay: 0.25,
            sustain: 0,
            release: 0.08,
          },
          gain: 0.22,
        },
        {
          source: {
            type: "square",
            frequency: {
              start: 180,
              end: 80,
            },
          },
          filter: {
            type: "lowpass",
            frequency: 800,
          },
          envelope: {
            attack: 0,
            decay: 0.2,
            sustain: 0,
            release: 0.06,
          },
          delay: 0.03,
          gain: 0.12,
        },
      ],
    },
    "delete": {
      layers: [
        {
          source: {
            type: "sawtooth",
            frequency: {
              start: 300,
              end: 100,
            },
          },
          filter: {
            type: "lowpass",
            frequency: 800,
          },
          envelope: {
            attack: 0,
            decay: 0.3,
            sustain: 0,
            release: 0.08,
          },
          gain: 0.18,
        },
        {
          source: {
            type: "square",
            frequency: {
              start: 200,
              end: 60,
            },
          },
          filter: {
            type: "lowpass",
            frequency: 600,
          },
          envelope: {
            attack: 0,
            decay: 0.25,
            sustain: 0,
            release: 0.06,
          },
          delay: 0.02,
          gain: 0.1,
        },
      ],
    },
    "warning": {
      layers: [
        {
          source: {
            type: "triangle",
            frequency: 440,
          },
          envelope: {
            attack: 0,
            decay: 0.18,
            sustain: 0.06,
            release: 0.06,
          },
          gain: 0.2,
        },
        {
          source: {
            type: "triangle",
            frequency: 466,
          },
          envelope: {
            attack: 0,
            decay: 0.18,
            sustain: 0.06,
            release: 0.06,
          },
          delay: 0.01,
          gain: 0.15,
        },
      ],
    },
    "swoosh": {
      source: {
        type: "noise",
        color: "white",
      },
      filter: {
        type: "bandpass",
        frequency: 300,
        resonance: 1.8,
        envelope: {
          attack: 0.01,
          peak: 4000,
          decay: 0.08,
        },
      },
      envelope: {
        attack: 0.01,
        decay: 0.12,
        sustain: 0,
        release: 0.04,
      },
      gain: 0.12,
    },
    "whoosh": {
      source: {
        type: "noise",
        color: "white",
      },
      filter: {
        type: "bandpass",
        frequency: 300,
        resonance: 1.5,
        envelope: {
          attack: 0.04,
          peak: 4000,
          decay: 0.16,
        },
      },
      envelope: {
        attack: 0.02,
        decay: 0.25,
        sustain: 0,
        release: 0.08,
      },
      gain: 0.15,
    },
    "page-enter": {
      source: {
        type: "noise",
        color: "white",
      },
      filter: {
        type: "bandpass",
        frequency: 400,
        resonance: 1.2,
        envelope: {
          attack: 0.03,
          peak: 3000,
          decay: 0.15,
        },
      },
      envelope: {
        attack: 0.02,
        decay: 0.2,
        sustain: 0,
        release: 0.06,
      },
      gain: 0.08,
    },
    "page-exit": {
      source: {
        type: "noise",
        color: "pink",
      },
      filter: {
        type: "bandpass",
        frequency: 2500,
        resonance: 1.2,
        envelope: {
          decay: 0.18,
          peak: 400,
        },
      },
      envelope: {
        attack: 0.01,
        decay: 0.2,
        sustain: 0,
        release: 0.06,
      },
      gain: 0.07,
    },
    "tab-switch": {
      source: {
        type: "sine",
        frequency: {
          start: 1100,
          end: 1500,
        },
        fm: {
          ratio: 0.5,
          depth: 50,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.05,
        sustain: 0,
        release: 0.015,
      },
      gain: 0.18,
    },
    "drawer-open": {
      source: {
        type: "sine",
        frequency: {
          start: 350,
          end: 1000,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.1,
        sustain: 0,
        release: 0.03,
      },
      gain: 0.08,
    },
    "drawer-close": {
      source: {
        type: "sine",
        frequency: {
          start: 800,
          end: 350,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.1,
        sustain: 0,
        release: 0.03,
      },
      gain: 0.06,
    },
    "modal-open": {
      source: {
        type: "sine",
        frequency: {
          start: 430,
          end: 1400,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.08,
        sustain: 0,
        release: 0.025,
      },
      gain: 0.1,
    },
    "modal-close": {
      source: {
        type: "sine",
        frequency: {
          start: 730,
          end: 430,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.08,
        sustain: 0,
        release: 0.025,
      },
      gain: 0.08,
    },
    "dropdown-open": {
      source: {
        type: "sine",
        frequency: {
          start: 500,
          end: 1200,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.06,
        sustain: 0,
        release: 0.02,
      },
      gain: 0.07,
    },
    "dropdown-close": {
      source: {
        type: "sine",
        frequency: {
          start: 900,
          end: 500,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.06,
        sustain: 0,
        release: 0.02,
      },
      gain: 0.05,
    },
    "slide": {
      source: {
        type: "noise",
        color: "white",
      },
      filter: {
        type: "bandpass",
        frequency: 500,
        resonance: 1,
        envelope: {
          attack: 0.02,
          peak: 3000,
          decay: 0.12,
        },
      },
      envelope: {
        attack: 0.01,
        decay: 0.15,
        sustain: 0,
        release: 0.05,
      },
      gain: 0.07,
    },
    "slide-up": {
      source: {
        type: "noise",
        color: "white",
      },
      filter: {
        type: "bandpass",
        frequency: 500,
        resonance: 1,
        envelope: {
          attack: 0.02,
          peak: 3500,
          decay: 0.12,
        },
      },
      envelope: {
        attack: 0.01,
        decay: 0.15,
        sustain: 0,
        release: 0.05,
      },
      gain: 0.07,
    },
    "slide-down": {
      source: {
        type: "noise",
        color: "pink",
      },
      filter: {
        type: "bandpass",
        frequency: 2500,
        resonance: 1,
        envelope: {
          decay: 0.12,
          peak: 500,
        },
      },
      envelope: {
        attack: 0.01,
        decay: 0.15,
        sustain: 0,
        release: 0.05,
      },
      gain: 0.06,
    },
    "copy": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 1200,
          },
          envelope: {
            attack: 0,
            decay: 0.015,
            sustain: 0,
            release: 0.006,
          },
          gain: 0.16,
        },
        {
          source: {
            type: "sine",
            frequency: 1400,
          },
          envelope: {
            attack: 0,
            decay: 0.015,
            sustain: 0,
            release: 0.006,
          },
          delay: 0.04,
          gain: 0.14,
        },
      ],
    },
    "send": {
      source: {
        type: "sine",
        frequency: {
          start: 500,
          end: 1200,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.15,
        sustain: 0,
        release: 0.04,
      },
      gain: 0.16,
    },
    "receive": {
      source: {
        type: "sine",
        frequency: {
          start: 1200,
          end: 700,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.12,
        sustain: 0.02,
        release: 0.04,
      },
      gain: 0.12,
    },
    "command": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: {
              start: 600,
              end: 900,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.05,
            sustain: 0,
            release: 0.015,
          },
          gain: 0.18,
        },
        {
          source: {
            type: "sine",
            frequency: {
              start: 900,
              end: 1100,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.04,
            sustain: 0,
            release: 0.012,
          },
          delay: 0.04,
          gain: 0.12,
        },
      ],
    },
    "escape": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: {
              start: 900,
              end: 600,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.05,
            sustain: 0,
            release: 0.015,
          },
          gain: 0.16,
        },
        {
          source: {
            type: "sine",
            frequency: {
              start: 700,
              end: 500,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.04,
            sustain: 0,
            release: 0.012,
          },
          delay: 0.03,
          gain: 0.1,
        },
      ],
    },
    "undo": {
      source: {
        type: "sine",
        frequency: {
          start: 900,
          end: 600,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.12,
        sustain: 0.02,
        release: 0.04,
      },
      gain: 0.14,
    },
    "archive": {
      source: {
        type: "sine",
        frequency: {
          start: 800,
          end: 550,
        },
      },
      envelope: {
        attack: 0.003,
        decay: 0.15,
        sustain: 0.02,
        release: 0.05,
      },
      gain: 0.12,
    },
    "sync": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 523,
          },
          envelope: {
            attack: 0,
            decay: 0.015,
            sustain: 0,
            release: 0.005,
          },
          gain: 0.14,
        },
        {
          source: {
            type: "sine",
            frequency: 784,
          },
          envelope: {
            attack: 0,
            decay: 0.015,
            sustain: 0,
            release: 0.005,
          },
          delay: 0.04,
          gain: 0.12,
        },
      ],
    },
    "heart": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: {
              start: 500,
              end: 300,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.1,
            sustain: 0,
            release: 0.04,
          },
          gain: 0.16,
        },
        {
          source: {
            type: "sine",
            frequency: 523,
            fm: {
              ratio: 2.5,
              depth: 100,
            },
          },
          envelope: {
            attack: 0.008,
            decay: 0.25,
            sustain: 0.04,
            release: 0.1,
          },
          gain: 0.1,
        },
      ],
    },
    "streak": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: {
              start: 523,
              end: 784,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.12,
            sustain: 0.02,
            release: 0.05,
          },
          gain: 0.16,
        },
        {
          source: {
            type: "sine",
            frequency: {
              start: 526,
              end: 787,
            },
            fm: {
              ratio: 2.5,
              depth: 100,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.11,
            sustain: 0.01,
            release: 0.05,
          },
          gain: 0.08,
        },
      ],
    },
    "loading-start": {
      source: {
        type: "sine",
        frequency: {
          start: 500,
          end: 700,
        },
      },
      envelope: {
        attack: 0.008,
        decay: 0.12,
        sustain: 0.02,
        release: 0.05,
      },
      gain: 0.08,
    },
    "loading-end": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: {
              start: 700,
              end: 880,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.1,
            sustain: 0.02,
            release: 0.04,
          },
          gain: 0.1,
        },
        {
          source: {
            type: "sine",
            frequency: {
              start: 880,
              end: 1046,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.08,
            sustain: 0.01,
            release: 0.04,
          },
          delay: 0.06,
          gain: 0.08,
        },
      ],
    },
    "progress-tick": {
      source: {
        type: "sine",
        frequency: 1400,
        fm: {
          ratio: 0.5,
          depth: 50,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.01,
        sustain: 0,
        release: 0.004,
      },
      gain: 0.1,
    },
  },
  minimal: {
    "tap": {
      source: {
        type: "sine",
        frequency: 1200,
      },
      envelope: {
        attack: 0,
        decay: 0.012,
        sustain: 0,
        release: 0.004,
      },
      gain: 0.08,
    },
    "click": {
      source: {
        type: "sine",
        frequency: 800,
      },
      envelope: {
        attack: 0,
        decay: 0.015,
        sustain: 0,
        release: 0.005,
      },
      gain: 0.1,
    },
    "key-press": {
      source: {
        type: "sine",
        frequency: 1100,
      },
      envelope: {
        attack: 0,
        decay: 0.01,
        sustain: 0,
        release: 0.003,
      },
      gain: 0.06,
    },
    "toggle-on": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 880,
          },
          envelope: {
            attack: 0,
            decay: 0.02,
            sustain: 0,
            release: 0.006,
          },
          gain: 0.08,
        },
        {
          source: {
            type: "sine",
            frequency: 1320,
          },
          envelope: {
            attack: 0,
            decay: 0.02,
            sustain: 0,
            release: 0.006,
          },
          delay: 0.03,
          gain: 0.07,
        },
      ],
    },
    "toggle-off": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 1320,
          },
          envelope: {
            attack: 0,
            decay: 0.02,
            sustain: 0,
            release: 0.006,
          },
          gain: 0.08,
        },
        {
          source: {
            type: "sine",
            frequency: 880,
          },
          envelope: {
            attack: 0,
            decay: 0.02,
            sustain: 0,
            release: 0.006,
          },
          delay: 0.03,
          gain: 0.07,
        },
      ],
    },
    "checkbox": {
      source: {
        type: "sine",
        frequency: 1000,
      },
      envelope: {
        attack: 0,
        decay: 0.018,
        sustain: 0,
        release: 0.005,
      },
      gain: 0.09,
    },
    "select": {
      source: {
        type: "sine",
        frequency: 1100,
      },
      envelope: {
        attack: 0,
        decay: 0.02,
        sustain: 0,
        release: 0.006,
      },
      gain: 0.08,
    },
    "deselect": {
      source: {
        type: "sine",
        frequency: 900,
      },
      envelope: {
        attack: 0,
        decay: 0.018,
        sustain: 0,
        release: 0.005,
      },
      gain: 0.06,
    },
    "hover": {
      source: {
        type: "sine",
        frequency: 1300,
      },
      envelope: {
        attack: 0,
        decay: 0.01,
        sustain: 0,
        release: 0.004,
      },
      gain: 0.04,
    },
    "tab-switch": {
      source: {
        type: "sine",
        frequency: 1050,
      },
      envelope: {
        attack: 0,
        decay: 0.015,
        sustain: 0,
        release: 0.005,
      },
      gain: 0.07,
    },
    "expand": {
      source: {
        type: "sine",
        frequency: {
          start: 800,
          end: 1000,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.04,
        sustain: 0,
        release: 0.012,
      },
      gain: 0.06,
    },
    "collapse": {
      source: {
        type: "sine",
        frequency: {
          start: 1000,
          end: 800,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.04,
        sustain: 0,
        release: 0.012,
      },
      gain: 0.06,
    },
    "page-enter": {
      source: {
        type: "sine",
        frequency: {
          start: 700,
          end: 900,
        },
      },
      envelope: {
        attack: 0.003,
        decay: 0.04,
        sustain: 0,
        release: 0.015,
      },
      gain: 0.05,
    },
    "page-exit": {
      source: {
        type: "sine",
        frequency: {
          start: 900,
          end: 700,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.04,
        sustain: 0,
        release: 0.015,
      },
      gain: 0.04,
    },
    "success": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 523,
          },
          envelope: {
            attack: 0,
            decay: 0.05,
            sustain: 0,
            release: 0.015,
          },
          gain: 0.1,
        },
        {
          source: {
            type: "sine",
            frequency: 784,
          },
          envelope: {
            attack: 0,
            decay: 0.05,
            sustain: 0,
            release: 0.015,
          },
          delay: 0.06,
          gain: 0.08,
        },
      ],
    },
    "error": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 300,
          },
          envelope: {
            attack: 0,
            decay: 0.04,
            sustain: 0,
            release: 0.012,
          },
          gain: 0.12,
        },
        {
          source: {
            type: "sine",
            frequency: 280,
          },
          envelope: {
            attack: 0,
            decay: 0.04,
            sustain: 0,
            release: 0.012,
          },
          delay: 0.01,
          gain: 0.1,
        },
      ],
    },
    "warning": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 440,
          },
          envelope: {
            attack: 0,
            decay: 0.03,
            sustain: 0,
            release: 0.01,
          },
          gain: 0.1,
        },
        {
          source: {
            type: "sine",
            frequency: 466,
          },
          envelope: {
            attack: 0,
            decay: 0.03,
            sustain: 0,
            release: 0.01,
          },
          delay: 0.008,
          gain: 0.08,
        },
      ],
    },
    "notification": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 660,
          },
          envelope: {
            attack: 0,
            decay: 0.05,
            sustain: 0,
            release: 0.02,
          },
          gain: 0.1,
        },
        {
          source: {
            type: "sine",
            frequency: 880,
          },
          envelope: {
            attack: 0,
            decay: 0.04,
            sustain: 0,
            release: 0.015,
          },
          delay: 0.08,
          gain: 0.08,
        },
      ],
    },
    "info": {
      source: {
        type: "sine",
        frequency: 880,
      },
      envelope: {
        attack: 0,
        decay: 0.04,
        sustain: 0,
        release: 0.015,
      },
      gain: 0.08,
    },
    "copy": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 1000,
          },
          envelope: {
            attack: 0,
            decay: 0.012,
            sustain: 0,
            release: 0.004,
          },
          gain: 0.08,
        },
        {
          source: {
            type: "sine",
            frequency: 1200,
          },
          envelope: {
            attack: 0,
            decay: 0.012,
            sustain: 0,
            release: 0.004,
          },
          delay: 0.035,
          gain: 0.07,
        },
      ],
    },
    "send": {
      source: {
        type: "sine",
        frequency: {
          start: 600,
          end: 1000,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.04,
        sustain: 0,
        release: 0.012,
      },
      gain: 0.08,
    },
    "delete": {
      source: {
        type: "sine",
        frequency: {
          start: 500,
          end: 250,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.05,
        sustain: 0,
        release: 0.015,
      },
      gain: 0.1,
    },
    "undo": {
      source: {
        type: "sine",
        frequency: {
          start: 800,
          end: 600,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.035,
        sustain: 0,
        release: 0.01,
      },
      gain: 0.07,
    },
    "pop": {
      source: {
        type: "sine",
        frequency: {
          start: 400,
          end: 200,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.04,
        sustain: 0,
        release: 0.012,
      },
      gain: 0.1,
    },
    "swoosh": {
      source: {
        type: "sine",
        frequency: {
          start: 600,
          end: 1400,
        },
      },
      envelope: {
        attack: 0.005,
        decay: 0.04,
        sustain: 0,
        release: 0.015,
      },
      gain: 0.05,
    },
    "slide": {
      source: {
        type: "sine",
        frequency: {
          start: 800,
          end: 1100,
        },
      },
      envelope: {
        attack: 0.003,
        decay: 0.035,
        sustain: 0,
        release: 0.012,
      },
      gain: 0.05,
    },
  },
  soft: {
    "tap": {
      source: {
        type: "triangle",
        frequency: 800,
      },
      envelope: {
        attack: 0.005,
        decay: 0.08,
        sustain: 0,
        release: 0.03,
      },
      gain: 0.15,
    },
    "click": {
      source: {
        type: "triangle",
        frequency: 600,
      },
      envelope: {
        attack: 0.005,
        decay: 0.1,
        sustain: 0,
        release: 0.04,
      },
      gain: 0.18,
    },
    "key-press": {
      source: {
        type: "triangle",
        frequency: 900,
      },
      envelope: {
        attack: 0.005,
        decay: 0.06,
        sustain: 0,
        release: 0.025,
      },
      gain: 0.12,
    },
    "toggle-on": {
      layers: [
        {
          source: {
            type: "triangle",
            frequency: 440,
          },
          envelope: {
            attack: 0.008,
            decay: 0.12,
            sustain: 0,
            release: 0.05,
          },
          gain: 0.15,
        },
        {
          source: {
            type: "triangle",
            frequency: 660,
          },
          envelope: {
            attack: 0.008,
            decay: 0.12,
            sustain: 0,
            release: 0.05,
          },
          delay: 0.05,
          gain: 0.13,
        },
      ],
    },
    "toggle-off": {
      layers: [
        {
          source: {
            type: "triangle",
            frequency: 660,
          },
          envelope: {
            attack: 0.008,
            decay: 0.12,
            sustain: 0,
            release: 0.05,
          },
          gain: 0.15,
        },
        {
          source: {
            type: "triangle",
            frequency: 440,
          },
          envelope: {
            attack: 0.008,
            decay: 0.12,
            sustain: 0,
            release: 0.05,
          },
          delay: 0.05,
          gain: 0.13,
        },
      ],
    },
    "checkbox": {
      source: {
        type: "triangle",
        frequency: {
          start: 500,
          end: 700,
        },
      },
      envelope: {
        attack: 0.006,
        decay: 0.1,
        sustain: 0,
        release: 0.04,
      },
      gain: 0.16,
    },
    "select": {
      source: {
        type: "triangle",
        frequency: 750,
      },
      envelope: {
        attack: 0.006,
        decay: 0.1,
        sustain: 0,
        release: 0.04,
      },
      gain: 0.14,
    },
    "deselect": {
      source: {
        type: "triangle",
        frequency: 600,
      },
      envelope: {
        attack: 0.006,
        decay: 0.09,
        sustain: 0,
        release: 0.035,
      },
      gain: 0.11,
    },
    "hover": {
      source: {
        type: "triangle",
        frequency: 900,
      },
      envelope: {
        attack: 0.008,
        decay: 0.06,
        sustain: 0,
        release: 0.025,
      },
      gain: 0.06,
    },
    "tab-switch": {
      source: {
        type: "triangle",
        frequency: {
          start: 650,
          end: 850,
        },
      },
      envelope: {
        attack: 0.005,
        decay: 0.08,
        sustain: 0,
        release: 0.03,
      },
      gain: 0.12,
    },
    "expand": {
      source: {
        type: "triangle",
        frequency: {
          start: 400,
          end: 600,
        },
      },
      envelope: {
        attack: 0.008,
        decay: 0.15,
        sustain: 0.02,
        release: 0.06,
      },
      gain: 0.1,
    },
    "collapse": {
      source: {
        type: "triangle",
        frequency: {
          start: 600,
          end: 400,
        },
      },
      envelope: {
        attack: 0.008,
        decay: 0.15,
        sustain: 0.02,
        release: 0.06,
      },
      gain: 0.1,
    },
    "page-enter": {
      source: {
        type: "triangle",
        frequency: {
          start: 350,
          end: 550,
        },
      },
      envelope: {
        attack: 0.01,
        decay: 0.2,
        sustain: 0,
        release: 0.08,
      },
      gain: 0.08,
    },
    "page-exit": {
      source: {
        type: "triangle",
        frequency: {
          start: 550,
          end: 350,
        },
      },
      envelope: {
        attack: 0.008,
        decay: 0.18,
        sustain: 0,
        release: 0.07,
      },
      gain: 0.07,
    },
    "success": {
      layers: [
        {
          source: {
            type: "triangle",
            frequency: 523,
          },
          envelope: {
            attack: 0.008,
            decay: 0.25,
            sustain: 0.04,
            release: 0.1,
          },
          gain: 0.14,
        },
        {
          source: {
            type: "triangle",
            frequency: 659,
          },
          envelope: {
            attack: 0.008,
            decay: 0.22,
            sustain: 0.03,
            release: 0.1,
          },
          delay: 0.1,
          gain: 0.12,
        },
        {
          source: {
            type: "triangle",
            frequency: 784,
          },
          envelope: {
            attack: 0.008,
            decay: 0.2,
            sustain: 0.03,
            release: 0.1,
          },
          delay: 0.2,
          gain: 0.1,
        },
      ],
    },
    "error": {
      layers: [
        {
          source: {
            type: "triangle",
            frequency: 300,
          },
          envelope: {
            attack: 0.005,
            decay: 0.2,
            sustain: 0,
            release: 0.08,
          },
          gain: 0.18,
        },
        {
          source: {
            type: "triangle",
            frequency: 280,
          },
          envelope: {
            attack: 0.005,
            decay: 0.18,
            sustain: 0,
            release: 0.07,
          },
          delay: 0.015,
          gain: 0.14,
        },
      ],
    },
    "warning": {
      layers: [
        {
          source: {
            type: "triangle",
            frequency: 392,
          },
          envelope: {
            attack: 0.006,
            decay: 0.15,
            sustain: 0.03,
            release: 0.06,
          },
          gain: 0.16,
        },
        {
          source: {
            type: "triangle",
            frequency: 415,
          },
          envelope: {
            attack: 0.006,
            decay: 0.15,
            sustain: 0.03,
            release: 0.06,
          },
          delay: 0.012,
          gain: 0.12,
        },
      ],
    },
    "notification": {
      layers: [
        {
          source: {
            type: "triangle",
            frequency: 523,
          },
          envelope: {
            attack: 0.008,
            decay: 0.3,
            sustain: 0.03,
            release: 0.12,
          },
          gain: 0.14,
        },
        {
          source: {
            type: "triangle",
            frequency: 784,
          },
          envelope: {
            attack: 0.008,
            decay: 0.25,
            sustain: 0.02,
            release: 0.1,
          },
          delay: 0.12,
          gain: 0.12,
        },
      ],
    },
    "info": {
      source: {
        type: "triangle",
        frequency: 660,
      },
      envelope: {
        attack: 0.008,
        decay: 0.2,
        sustain: 0.03,
        release: 0.08,
      },
      gain: 0.12,
    },
    "copy": {
      layers: [
        {
          source: {
            type: "triangle",
            frequency: 700,
          },
          envelope: {
            attack: 0.005,
            decay: 0.06,
            sustain: 0,
            release: 0.025,
          },
          gain: 0.13,
        },
        {
          source: {
            type: "triangle",
            frequency: 900,
          },
          envelope: {
            attack: 0.005,
            decay: 0.06,
            sustain: 0,
            release: 0.025,
          },
          delay: 0.06,
          gain: 0.11,
        },
      ],
    },
    "send": {
      source: {
        type: "triangle",
        frequency: {
          start: 400,
          end: 800,
        },
      },
      envelope: {
        attack: 0.005,
        decay: 0.15,
        sustain: 0,
        release: 0.06,
      },
      gain: 0.13,
    },
    "delete": {
      source: {
        type: "triangle",
        frequency: {
          start: 450,
          end: 200,
        },
      },
      envelope: {
        attack: 0.005,
        decay: 0.2,
        sustain: 0,
        release: 0.08,
      },
      gain: 0.15,
    },
    "undo": {
      source: {
        type: "triangle",
        frequency: {
          start: 600,
          end: 400,
        },
      },
      envelope: {
        attack: 0.006,
        decay: 0.12,
        sustain: 0,
        release: 0.05,
      },
      gain: 0.11,
    },
    "pop": {
      source: {
        type: "triangle",
        frequency: {
          start: 350,
          end: 150,
        },
      },
      envelope: {
        attack: 0.005,
        decay: 0.12,
        sustain: 0,
        release: 0.05,
      },
      gain: 0.18,
    },
    "swoosh": {
      source: {
        type: "triangle",
        frequency: {
          start: 400,
          end: 1000,
        },
      },
      envelope: {
        attack: 0.01,
        decay: 0.15,
        sustain: 0,
        release: 0.06,
      },
      gain: 0.08,
    },
    "slide": {
      source: {
        type: "triangle",
        frequency: {
          start: 500,
          end: 750,
        },
      },
      envelope: {
        attack: 0.008,
        decay: 0.12,
        sustain: 0,
        release: 0.05,
      },
      gain: 0.08,
    },
  },
  crisp: {
    "tap": {
      source: {
        type: "sine",
        frequency: 1300,
        fm: {
          ratio: 0.5,
          depth: 100,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.015,
        sustain: 0,
        release: 0.005,
      },
      gain: 0.2,
    },
    "click": {
      source: {
        type: "sine",
        frequency: {
          start: 200,
          end: 700,
        },
        fm: {
          ratio: 0.5,
          depth: 80,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.06,
        sustain: 0,
        release: 0.02,
      },
      gain: 0.22,
    },
    "key-press": {
      source: {
        type: "sine",
        frequency: 1400,
        fm: {
          ratio: 0.5,
          depth: 70,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.012,
        sustain: 0,
        release: 0.004,
      },
      gain: 0.16,
    },
    "toggle-on": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 1047,
            fm: {
              ratio: 1.5,
              depth: 60,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.03,
            sustain: 0,
            release: 0.01,
          },
          gain: 0.2,
        },
        {
          source: {
            type: "sine",
            frequency: 1568,
            fm: {
              ratio: 1.5,
              depth: 50,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.03,
            sustain: 0,
            release: 0.01,
          },
          delay: 0.025,
          gain: 0.18,
        },
      ],
    },
    "toggle-off": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 1568,
            fm: {
              ratio: 1.5,
              depth: 60,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.03,
            sustain: 0,
            release: 0.01,
          },
          gain: 0.2,
        },
        {
          source: {
            type: "sine",
            frequency: 1047,
            fm: {
              ratio: 1.5,
              depth: 50,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.03,
            sustain: 0,
            release: 0.01,
          },
          delay: 0.025,
          gain: 0.18,
        },
      ],
    },
    "checkbox": {
      source: {
        type: "sine",
        frequency: {
          start: 300,
          end: 900,
        },
        fm: {
          ratio: 0.5,
          depth: 60,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.05,
        sustain: 0,
        release: 0.015,
      },
      gain: 0.2,
    },
    "select": {
      source: {
        type: "sine",
        frequency: 1200,
        fm: {
          ratio: 1,
          depth: 80,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.04,
        sustain: 0,
        release: 0.012,
      },
      gain: 0.18,
    },
    "deselect": {
      source: {
        type: "sine",
        frequency: 1000,
        fm: {
          ratio: 1,
          depth: 60,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.035,
        sustain: 0,
        release: 0.01,
      },
      gain: 0.14,
    },
    "hover": {
      source: {
        type: "sine",
        frequency: 1500,
        fm: {
          ratio: 0.5,
          depth: 40,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.015,
        sustain: 0,
        release: 0.005,
      },
      gain: 0.06,
    },
    "tab-switch": {
      source: {
        type: "sine",
        frequency: {
          start: 1000,
          end: 1400,
        },
        fm: {
          ratio: 0.5,
          depth: 50,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.04,
        sustain: 0,
        release: 0.012,
      },
      gain: 0.16,
    },
    "expand": {
      source: {
        type: "sine",
        frequency: {
          start: 600,
          end: 900,
        },
        fm: {
          ratio: 1,
          depth: 50,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.06,
        sustain: 0,
        release: 0.02,
      },
      gain: 0.12,
    },
    "collapse": {
      source: {
        type: "sine",
        frequency: {
          start: 900,
          end: 600,
        },
        fm: {
          ratio: 1,
          depth: 50,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.06,
        sustain: 0,
        release: 0.02,
      },
      gain: 0.12,
    },
    "page-enter": {
      source: {
        type: "sine",
        frequency: {
          start: 500,
          end: 900,
        },
        fm: {
          ratio: 0.5,
          depth: 60,
        },
      },
      envelope: {
        attack: 0.003,
        decay: 0.08,
        sustain: 0,
        release: 0.025,
      },
      gain: 0.1,
    },
    "page-exit": {
      source: {
        type: "sine",
        frequency: {
          start: 900,
          end: 500,
        },
        fm: {
          ratio: 0.5,
          depth: 60,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.08,
        sustain: 0,
        release: 0.025,
      },
      gain: 0.08,
    },
    "success": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 523,
            fm: {
              ratio: 2,
              depth: 100,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.12,
            sustain: 0,
            release: 0.04,
          },
          gain: 0.18,
        },
        {
          source: {
            type: "sine",
            frequency: 659,
            fm: {
              ratio: 2,
              depth: 80,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.1,
            sustain: 0,
            release: 0.04,
          },
          delay: 0.06,
          gain: 0.16,
        },
        {
          source: {
            type: "sine",
            frequency: 784,
            fm: {
              ratio: 2,
              depth: 70,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.1,
            sustain: 0,
            release: 0.04,
          },
          delay: 0.12,
          gain: 0.14,
        },
      ],
    },
    "error": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: {
              start: 400,
              end: 200,
            },
            fm: {
              ratio: 1.5,
              depth: 150,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.1,
            sustain: 0,
            release: 0.03,
          },
          gain: 0.22,
        },
        {
          source: {
            type: "sine",
            frequency: {
              start: 250,
              end: 120,
            },
            fm: {
              ratio: 1.5,
              depth: 120,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.08,
            sustain: 0,
            release: 0.025,
          },
          delay: 0.03,
          gain: 0.15,
        },
      ],
    },
    "warning": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 440,
            fm: {
              ratio: 1,
              depth: 80,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.08,
            sustain: 0,
            release: 0.025,
          },
          gain: 0.2,
        },
        {
          source: {
            type: "sine",
            frequency: 466,
            fm: {
              ratio: 1,
              depth: 70,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.08,
            sustain: 0,
            release: 0.025,
          },
          delay: 0.01,
          gain: 0.16,
        },
      ],
    },
    "notification": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 780,
            fm: {
              ratio: 1.5,
              depth: 120,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.15,
            sustain: 0,
            release: 0.05,
          },
          gain: 0.18,
        },
        {
          source: {
            type: "sine",
            frequency: 1170,
            fm: {
              ratio: 1.5,
              depth: 100,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.12,
            sustain: 0,
            release: 0.04,
          },
          delay: 0.08,
          gain: 0.15,
        },
      ],
    },
    "info": {
      source: {
        type: "sine",
        frequency: 880,
        fm: {
          ratio: 2,
          depth: 100,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.1,
        sustain: 0,
        release: 0.035,
      },
      gain: 0.15,
    },
    "copy": {
      layers: [
        {
          source: {
            type: "sine",
            frequency: 1200,
            fm: {
              ratio: 0.5,
              depth: 60,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.02,
            sustain: 0,
            release: 0.006,
          },
          gain: 0.16,
        },
        {
          source: {
            type: "sine",
            frequency: 1500,
            fm: {
              ratio: 0.5,
              depth: 50,
            },
          },
          envelope: {
            attack: 0,
            decay: 0.02,
            sustain: 0,
            release: 0.006,
          },
          delay: 0.035,
          gain: 0.14,
        },
      ],
    },
    "send": {
      source: {
        type: "sine",
        frequency: {
          start: 500,
          end: 1200,
        },
        fm: {
          ratio: 1,
          depth: 80,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.1,
        sustain: 0,
        release: 0.03,
      },
      gain: 0.16,
    },
    "delete": {
      source: {
        type: "sine",
        frequency: {
          start: 500,
          end: 180,
        },
        fm: {
          ratio: 1.5,
          depth: 130,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.12,
        sustain: 0,
        release: 0.04,
      },
      gain: 0.2,
    },
    "undo": {
      source: {
        type: "sine",
        frequency: {
          start: 900,
          end: 600,
        },
        fm: {
          ratio: 0.5,
          depth: 60,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.08,
        sustain: 0,
        release: 0.025,
      },
      gain: 0.14,
    },
    "pop": {
      source: {
        type: "sine",
        frequency: {
          start: 500,
          end: 200,
        },
        fm: {
          ratio: 0.5,
          depth: 80,
        },
      },
      envelope: {
        attack: 0,
        decay: 0.06,
        sustain: 0,
        release: 0.02,
      },
      gain: 0.22,
    },
    "swoosh": {
      source: {
        type: "sine",
        frequency: {
          start: 400,
          end: 1800,
        },
        fm: {
          ratio: 0.5,
          depth: 50,
        },
      },
      envelope: {
        attack: 0.005,
        decay: 0.08,
        sustain: 0,
        release: 0.025,
      },
      gain: 0.1,
    },
    "slide": {
      source: {
        type: "sine",
        frequency: {
          start: 600,
          end: 1000,
        },
        fm: {
          ratio: 0.5,
          depth: 50,
        },
      },
      envelope: {
        attack: 0.003,
        decay: 0.06,
        sustain: 0,
        release: 0.02,
      },
      gain: 0.08,
    },
  },
};
