// Development-only harness: exposes the engine to the browser test driver so
// the audio path can be asserted on real rendered samples rather than mocks.
import { parseSong, parseSongText } from '../src/format/parse'
import { serialiseSong } from '../src/format/serialize'
import { analyseRender, encodeWav, renderSong } from '../src/engine/render'
import { buildTimeline } from '../src/engine/sequencer'

Object.assign(window, {
  harness: { parseSong, parseSongText, serialiseSong, renderSong, analyseRender, encodeWav, buildTimeline },
})
document.body.dataset['ready'] = 'true'
