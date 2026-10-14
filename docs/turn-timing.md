# Reading reply timing

The agent emits `codetrial turn_timing` when the first reply audio chunk is
accepted into its output queue. Later chunks do not emit another summary.
A pending measurement that ends without that chunk emits `outcome=no_audio`,
`interrupted`, `replaced`, `paused`, `held`, or `ended` instead. Replacements
finish the old measurement before the socket number changes; the new socket
starts with no inherited timestamps or tool counters.

For example, this synthetic measurement has one tool call before audio:

```text
codetrial turn_timing room=interview-example session=42 socket=1 turn=7 at=0:03.000 start_source=pcm_level wait_ms=3000 elapsed_ms=3000 transcript_wait_ms=2900 turn_close_ms=1500 turn_close_source=voice_activity_received turn_close_reason=observed vad_audio_offset_ms=99000 tool_calls=1 pre_tool_ms=2000 tool_phase_ms=1000 tool_exec_ms=400 tool_response_ms=100 tool_response_errors=0 tool_wait_ms=500 tool_after_close_ms=500 other_ms=1000 outcome=audio
```

`room`, `session`, `socket` and `turn` identify a measurement. `turn` is a local
sequence, not a provider turn ID or the `usage_event` counter. `at` is elapsed
interview time at emission. The line contains no transcript, code, tool
arguments, credentials or tokens.

| Field | Boundary or meaning |
|---|---|
| `start_source=pcm_level` | Last candidate PCM frame above the local voice-level threshold before the measurement freezes |
| `start_source=last_transcript` | Last input transcription receipt that armed a candidate reply wait, when no PCM proxy is available |
| `start_source=unknown` | No usable start proxy was observed, as in a greeting, platform prompt reply, or activity-end signal without a recent PCM frame or transcript |
| `wait_ms` | From that start proxy to the first accepted reply audio chunk; unknown when no audio arrived or no start was observed |
| `elapsed_ms` | From the same proxy to emission, including outcomes with no audio |
| `transcript_wait_ms` | From the last input transcript that armed a candidate reply wait to accepted reply audio; a separate receipt-clock cross-check |
| `turn_close_ms` | From the start proxy to receipt of Gemini `voiceActivity.ACTIVITY_END`; unknown if absent or ordered before the start |
| `turn_close_source` | `voice_activity_received` when that interval is available, otherwise `unknown` |
| `turn_close_reason` | `observed`, `no_start`, `not_observed`, `before_start`, or `after_audio`; missing and unusably ordered observations remain unknown |
| `vad_audio_offset_ms` | Provider audio-stream offset accompanying that signal, if valid; never mixed with the local monotonic clock |
| `tool_calls` | Calls locally executed before the first accepted audio chunk |
| `pre_tool_ms` | From the start proxy to entry into the first tool handler, if both are observed in that order |
| `tool_phase_ms` | From that first tool handler to accepted reply audio, including sends, board preparation, subsequent calls and model continuation; unknown without tools or reply audio |
| `tool_exec_ms` | Sum of local tool execution durations, excluding network sends |
| `tool_response_ms` | Sum of tool-response WebSocket send durations, including failed attempts |
| `tool_response_errors` | Failed tool-response sends in that window |
| `tool_wait_ms` | Union of local execution and response-send intervals clipped to the speech-proxy-to-audio window; overlapping work is counted once |
| `tool_after_close_ms` | The same union clipped to the valid turn-close-to-audio window; unknown without a usable close or reply audio |
| `other_ms` | Wait remaining after turn-close and tool work after close; unknown when either component is unavailable or inconsistent |

A transcription or provider activity observation establishes candidate speech;
microphone levels alone cannot assign a candidate wait to a greeting. A PCM
frame is usable when it precedes the speech observation by less than two
seconds; an older frame cannot stand in for a quiet answer's speech ending.
Before endpointing or model output, PCM may advance the speech-end proxy as the
candidate continues. The first activity-end signal or model output (including
a tool request) freezes the primary start. Later PCM and late transcripts
cannot shorten that wait or erase its endpoint. Accepted transcripts still
update the separate transcription cross-check.

A provider `ACTIVITY_START` can reopen speech before generation starts. During
generation, an activity-start observation is retained for the next measurement
until the old model turn ends. The original voice-activity event order and
interruption policy are preserved. A raw level crossing is never enough to
reopen a frozen measurement. Output transcripts received after turn completion
cannot create another measurement for the completed reply.

Durations are rounded down to whole milliseconds. A fast tool may report zero
milliseconds while still incrementing `tool_calls`. Tools handled during a
pause, thinking hold, or discarded generation are excluded, as are calls after
the first reply audio. Board-image preparation, provider inference and event
queue delays are not local tool execution.

`tool_phase_ms` includes `tool_exec_ms` and `tool_response_ms`; these fields
are not additive. A long tool phase with fast local execution can indicate
waiting for the model's continuation. It does not prove which provider or
network operation caused the wait. Without a PCM observation, a late transcript
fallback can put the start proxy after a tool request. Then `pre_tool_ms` is
unknown, and only the portion of tool work inside the wait is attributed to it.

When all observations are usable, the decomposition is:

```text
wait = turn_close + tool_after_close + other
```

The example above reads as 3000 = 1500 + 500 + 1000 milliseconds. Work before
close is already covered by `turn_close_ms` and must not be added again. The
unclipped execution/send sums and `tool_phase_ms` describe operations, while
the clipped unions describe their contribution to waiting. `other_ms` includes
model continuation, transport, board preparation and event-processing delays;
it is not a measurement of provider inference alone. Missing close observations
do not become zero or a residual labeled as VAD. Independently rounded fields
can differ from the total by up to two milliseconds.

The PCM threshold is a speech proxy: noise or echo can cross it, and quiet
speech can fall below it. Transcription receipt can lag the final spoken word.
The end signal's receipt includes transport and room-event processing delay;
`turn_close_ms` is an observed endpointing interval, not pure provider VAD
processing time. Missing signals remain unknown. Subtracting tool durations
from `wait_ms` does not measure VAD latency. The audio queue's acceptance is
also earlier than browser playout, so this is not an end-to-end audible-delay
measurement.

Gemini `turnComplete` closes the model's turn, not the candidate's speech.
The automatic detection setting and its silence window are unchanged by this
instrumentation. Timing observations never feed model prompts or recovery
deadlines. See the [Live API reference](https://ai.google.dev/api/live#VoiceActivity)
for the optional activity signal and its separate audio clock.

For a manual check, use a rebuilt binary, speak a complete answer, and compare
the next summary with one where the interviewer reads the editor. Check that
the latter has tool activity, that later audio chunks add no summaries, and
that a cut, pause or replacement leaves the next measurement with fresh
timestamps. A naturally slow reply is useful evidence, not a prerequisite for
testing the arithmetic with controlled timestamps in `tests/unit/livekit/`.
