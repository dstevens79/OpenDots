import type { AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

const DEFAULT_MODEL = 'Xenova/whisper-tiny.en';
function selectedModel() {
  return localStorage.getItem('opendots-whisper-model') || DEFAULT_MODEL;
}
let pipelinePromise: Promise<AutomaticSpeechRecognitionPipeline> | undefined;
let loadedModel = '';

async function transcriber(onProgress: (message: string) => void) {
  const modelName = selectedModel();
  if (!pipelinePromise || loadedModel !== modelName) {
    loadedModel = modelName;
    pipelinePromise = import('@huggingface/transformers')
      .then(async ({ pipeline, env }) => {
        env.useBrowserCache = true;
        return (await pipeline('automatic-speech-recognition', modelName, {
          dtype: 'q8',
          progress_callback: (progress: {
            status?: string;
            file?: string;
            progress?: number;
          }) => {
            if (
              progress.status === 'progress' &&
              typeof progress.progress === 'number'
            )
              onProgress(
                `Downloading local speech model ${Math.round(progress.progress)}%`,
              );
            else if (progress.status === 'initiate')
              onProgress('Downloading local speech model…');
            else if (progress.status === 'ready')
              onProgress('Preparing local speech model…');
          },
        })) as AutomaticSpeechRecognitionPipeline;
      })
      .catch((error: unknown) => {
        pipelinePromise = undefined;
        loadedModel = '';
        throw error;
      });
  }
  return pipelinePromise;
}

function audioBufferToMono(
  buffer: AudioBuffer,
  sampleRate = 16000,
): Float32Array {
  const length = Math.ceil(
    (buffer.duration || buffer.length / buffer.sampleRate) * sampleRate,
  );
  const mono = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const position = (i * buffer.sampleRate) / sampleRate;
      const left = Math.floor(position);
      const fraction = position - left;
      const sample =
        left + 1 < source.length
          ? source[left] * (1 - fraction) + source[left + 1] * fraction
          : (source[Math.min(left, source.length - 1)] ?? 0);
      mono[i] += sample / buffer.numberOfChannels;
    }
  }
  return mono;
}

export async function transcribeAudio(
  blob: Blob,
  onProgress: (message: string) => void = () => {},
): Promise<string> {
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(
      await blob.arrayBuffer(),
    );
    const samples = audioBufferToMono(decoded);
    const model = await transcriber(onProgress);
    onProgress('Transcribing on this device…');
    const result = await model(samples, {
      language: 'english',
      task: 'transcribe',
    });
    return result.text.trim();
  } finally {
    await audioContext.close();
  }
}

export const localTranscriptionModel = selectedModel;
