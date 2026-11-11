import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

export async function listenForSpeech(language = 'en-US') {
  if (Capacitor.isNativePlatform()) {
    const availability = await SpeechRecognition.available();
    if (!availability.available) {
      throw new Error('Speech recognition is not available. Check that Google voice services are installed and enabled.');
    }

    let permission = await SpeechRecognition.checkPermissions();
    if (permission.speechRecognition !== 'granted') {
      permission = await SpeechRecognition.requestPermissions();
    }
    if (permission.speechRecognition !== 'granted') {
      throw new Error('Microphone permission was not granted. Allow it in Android app settings.');
    }

    const result = await SpeechRecognition.start({
      language,
      maxResults: 1,
      partialResults: false,
      popup: true
    });
    const transcript = result.matches?.[0]?.trim();
    if (!transcript) throw new Error('I could not hear any words. Please try again.');
    return transcript;
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    throw new Error('Voice input is not supported in this browser. Try the Buddy Android app.');
  }

  return new Promise((resolve, reject) => {
    const recognition = new Recognition();
    let settled = false;
    recognition.lang = language;
    recognition.maxAlternatives = 1;
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onresult = event => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (!settled) {
        settled = true;
        transcript ? resolve(transcript) : reject(new Error('I could not hear any words. Please try again.'));
      }
    };
    recognition.onerror = event => {
      if (settled) return;
      settled = true;
      reject(new Error(event.error === 'not-allowed'
        ? 'Microphone permission was denied. Allow microphone access and try again.'
        : 'Voice input failed. Please try again.'));
    };
    recognition.onend = () => {
      if (!settled) {
        settled = true;
        reject(new Error('No speech was detected. Please try again.'));
      }
    };
    try {
      recognition.start();
    } catch {
      settled = true;
      reject(new Error('The microphone could not start. Please try again.'));
    }
  });
}


let activeSpeechAudio = null;
let activeSpeechUrl = null;
let activeSpeechController = null;

export async function speakText(text, language = 'en-US') {
  const message = String(text || '').trim();
  if (!message) return;
  const token = localStorage.getItem('buddy_access_token');
  if (!token) throw new Error('Buddy access token is missing. Reopen Buddy and enter your access token.');

  if (activeSpeechAudio) { activeSpeechAudio.pause(); activeSpeechAudio.currentTime = 0; }
  if (activeSpeechUrl) URL.revokeObjectURL(activeSpeechUrl);
  if (activeSpeechController) activeSpeechController.abort();

  const controller = new AbortController();
  activeSpeechController = controller;
  try {
    const response = await fetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ text: message, language }),
      signal: controller.signal
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'OpenAI voice failed (' + response.status + ').');
    }
    const audioBlob = await response.blob();
    if (!audioBlob.size) throw new Error('OpenAI returned an empty voice recording.');
    activeSpeechUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(activeSpeechUrl);
    activeSpeechAudio = audio;
    await audio.play();
    await new Promise((resolve, reject) => {
      audio.onended = resolve;
      audio.onerror = () => reject(new Error('Buddy could not play the generated audio on this device.'));
    });
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('OpenAI Coral voice playback failed:', error);
    throw error;
  } finally {
    if (activeSpeechAudio) { activeSpeechAudio.onended = null; activeSpeechAudio.onerror = null; }
    activeSpeechAudio = null;
    if (activeSpeechUrl) URL.revokeObjectURL(activeSpeechUrl);
    activeSpeechUrl = null;
    if (activeSpeechController === controller) activeSpeechController = null;
  }
}


export async function stopSpeaking() {
  if (activeSpeechController) activeSpeechController.abort();
  if (activeSpeechAudio) {
    activeSpeechAudio.pause();
    activeSpeechAudio.currentTime = 0;
    activeSpeechAudio = null;
  }
  if (activeSpeechUrl) {
    URL.revokeObjectURL(activeSpeechUrl);
    activeSpeechUrl = null;
  }
}
