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

export async function speakText(text, language = 'en-US') {
  const message = String(text || '').trim();
  if (!message) return;

  if (Capacitor.isNativePlatform()) {
    if (!Capacitor.isPluginAvailable('TextToSpeech')) {
      throw new Error('This installed Buddy APK does not include the native Text-to-Speech module yet. A new APK is required before Android can speak. No APK has been built.');
    }

    try {
      const languageCheck = await TextToSpeech.isLanguageSupported({ lang: language });
      if (!languageCheck.supported) {
        const baseLanguage = language.split('-')[0];
        const available = await TextToSpeech.getSupportedLanguages();
        const fallback = available.languages?.find(item => item.toLowerCase().startsWith(baseLanguage.toLowerCase()));
        if (!fallback) {
          throw new Error('No installed Android voice supports ' + language + '. Install its speech data in Android Text-to-Speech settings, then try again.');
        }
        language = fallback;
      }

      await TextToSpeech.stop();
      await TextToSpeech.speak({
        text: message,
        lang: language,
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        category: 'ambient',
        queueStrategy: 0
      });
      return;
    } catch (error) {
      console.error('Native Android text-to-speech failed:', error);
      const detail = error?.message || String(error);
      if (detail.includes('No installed Android voice')) throw error;
      throw new Error('Android Text-to-Speech failed: ' + detail + '. Check Settings > Additional settings > Languages & input > Text-to-speech output, select an installed engine (such as Speech Services by Google), and install the selected language voice.');
    }
  }

  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    throw new Error('Spoken replies are not supported by this browser.');
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = language;
  utterance.rate = 1;
  utterance.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const exactVoice = voices.find(voice => voice.lang.toLowerCase() === language.toLowerCase());
  const languageVoice = voices.find(voice => voice.lang.toLowerCase().startsWith(language.split('-')[0].toLowerCase()));
  if (exactVoice || languageVoice) utterance.voice = exactVoice || languageVoice;
  window.speechSynthesis.speak(utterance);
}

export async function stopSpeaking() {
  if (Capacitor.isNativePlatform()) {
    try {
      await TextToSpeech.stop();
    } catch (error) {
      console.warn('Could not stop native speech:', error);
    }
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
