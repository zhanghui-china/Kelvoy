"""Pipeline steps for the Kelvoy travel-vlog engine.

Stage list is TBD — likely something like: footage ingest -> highlight
detection -> narration/script generation -> voiceover (TTS) -> music
selection -> composition/editing -> publish. See docs/decisions/ for when
this gets locked down. Each stage should follow visionary's convention:
a pure `run(project, providers) -> project` function, one file per stage.
"""
