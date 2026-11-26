// Adaptado de visage/frontend/src/components/totem/totemAudio.ts e useTotemSounds.ts (fonte somente leitura)
//
// Um só <audio> para o totem: um bipe novo interrompe o anterior. Sem as falas da Visage (dependem de configuração no servidor).
let element: HTMLAudioElement | null = null;

function play(src: string): void {
  try {
    element ??= new Audio();
    element.pause();
    element.src = src;
    // Autoplay bloqueado antes do primeiro toque: o totem segue sem som.
    void element.play()?.catch(() => undefined);
  } catch {
    /* navegador sem áudio */
  }
}

export const playSuccess = () => play('/audio/sucesso.wav');
export const playError = () => play('/audio/erro.wav');
