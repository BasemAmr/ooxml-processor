export interface VoiceTypingProvider { readonly isSupported: boolean; start(onTranscript: (text: string, isFinal: boolean) => void): void; stop(): void; }

type SpeechRecognitionLike = { start(): void; stop(): void; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null };

type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };

export class BrowserVoiceTypingProvider implements VoiceTypingProvider {
  private recognition: SpeechRecognitionLike | undefined;
  get isSupported(): boolean { const w = typeof window === 'undefined' ? undefined : window as SpeechWindow; return Boolean(w?.SpeechRecognition ?? w?.webkitSpeechRecognition); }
  start(onTranscript: (text: string, isFinal: boolean) => void): void {
    if (!this.isSupported) return;
    const w = window as SpeechWindow;
    const Constructor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Constructor) return;
    const recognition = new Constructor();
    recognition.onresult = (event) => { const first = event.results[0]?.[0]; if (first) onTranscript(first.transcript, true); };
    recognition.onerror = () => undefined;
    this.recognition = recognition;
    recognition.start();
  }
  stop(): void { this.recognition?.stop(); this.recognition = undefined; }
}
