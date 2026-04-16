export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

export interface WebRTCCallbacks {
  onConnected: () => void;
  onTranscript: (entry: TranscriptEntry) => void;
  onError: (error: string) => void;
  onDisconnected: () => void;
  onAiSpeakingChange?: (speaking: boolean) => void;
}

export interface WebRTCSession {
  disconnect: () => void;
  setMicEnabled: (enabled: boolean) => void;
  commitAudioAndRespond: () => void;
  nudgeStudent: () => void;
  cancelAiResponse: () => void;
  getRecordingBlob: () => Promise<Blob | null>;
  setPlaybackRate: (rate: number) => void;
}

const REALTIME_API_URL = "https://api.openai.com/v1/realtime";
const MODEL = "gpt-4o-realtime-preview";

export async function startWebRTC(
  ephemeralKey: string,
  callbacks: WebRTCCallbacks
): Promise<WebRTCSession> {
  const pc = new RTCPeerConnection();

  // AI 음성 출력용 audio element
  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;

  // 오디오 녹음용: 마이크 + AI 음성을 믹싱
  const audioCtx = new AudioContext();
  const mixDest = audioCtx.createMediaStreamDestination();
  const recordingChunks: Blob[] = [];
  let recorder: MediaRecorder | null = null;

  pc.ontrack = (event) => {
    audioEl.srcObject = event.streams[0];
    // AI 오디오를 믹서에 연결
    const remoteSource = audioCtx.createMediaStreamSource(event.streams[0]);
    remoteSource.connect(mixDest);
  };

  // 마이크 입력 (기본 음소거)
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioTrack = stream.getTracks()[0];
  audioTrack.enabled = false; // PTT: 기본 음소거
  pc.addTrack(audioTrack);

  // 마이크를 믹서에 연결
  const micSource = audioCtx.createMediaStreamSource(stream);
  micSource.connect(mixDest);

  // MediaRecorder 시작
  recorder = new MediaRecorder(mixDest.stream, { mimeType: "audio/webm;codecs=opus" });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordingChunks.push(e.data);
  };
  recorder.start(1000); // 1초 단위 chunk

  // DataChannel: OpenAI 이벤트 수신
  const dc = pc.createDataChannel("oai-events");

  // 어시스턴트 응답 텍스트를 누적하기 위한 변수
  let assistantBuffer = "";

  dc.onopen = () => {
    callbacks.onConnected();
  };

  dc.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleEvent(msg, callbacks, () => assistantBuffer, (v) => { assistantBuffer = v; });
    } catch {
      // 파싱 실패 무시
    }
  };

  dc.onclose = () => {
    callbacks.onDisconnected();
  };

  // SDP Offer 생성 → OpenAI로 전송 → Answer 수신
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpResponse = await fetch(`${REALTIME_API_URL}?model=${MODEL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ephemeralKey}`,
      "Content-Type": "application/sdp",
    },
    body: offer.sdp,
  });

  if (!sdpResponse.ok) {
    const errorText = await sdpResponse.text();
    throw new Error(`WebRTC 연결 실패: ${sdpResponse.status} ${errorText}`);
  }

  const answerSdp = await sdpResponse.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  // PTT: 마이크 on/off + 녹음 중엔 AI 오디오 음소거
  const setMicEnabled = (enabled: boolean) => {
    audioTrack.enabled = enabled;
    audioEl.muted = enabled; // 녹음 시작 → mute, 녹음 끝 → unmute
  };

  // PTT: 녹음 끝 → 오디오 버퍼 커밋 + AI 응답 요청
  const commitAudioAndRespond = () => {
    if (dc.readyState === "open") {
      dc.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      dc.send(JSON.stringify({ type: "response.create" }));
    }
  };

  // 독려: 학생이 오래 응답 안 할 때 AI가 먼저 말 걸기
  const nudgeStudent = () => {
    if (dc.readyState === "open") {
      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: "[시스템: 학생이 30초 동안 답하지 않았습니다. 과외 선생님처럼 부드럽게 다시 말을 걸어주세요. 예: '자, 이제 좀 생각해본 것 같은데 한번 얘기해볼까?' 또는 '어려우면 힌트를 줄까?' 같은 식으로요. 자연스럽게 격려해주세요.]",
          }],
        },
      }));
      dc.send(JSON.stringify({ type: "response.create" }));
    }
  };

  // AI 응답 중단 — setMicEnabled(true)가 mute 처리하므로 cancel만
  const cancelAiResponse = () => {
    if (dc.readyState === "open") {
      dc.send(JSON.stringify({ type: "response.cancel" }));
    }
  };

  // 녹음 데이터 가져오기
  const getRecordingBlob = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!recorder || recorder.state === "inactive") {
        resolve(recordingChunks.length > 0 ? new Blob(recordingChunks, { type: "audio/webm" }) : null);
        return;
      }
      recorder.onstop = () => {
        resolve(recordingChunks.length > 0 ? new Blob(recordingChunks, { type: "audio/webm" }) : null);
      };
      recorder.stop();
    });
  };

  // 연결 해제 함수
  const disconnect = () => {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
    dc.close();
    pc.close();
    audioEl.srcObject = null;
    audioCtx.close();
  };

  const setPlaybackRate = (rate: number) => {
    audioEl.playbackRate = rate;
  };

  return { disconnect, setMicEnabled, commitAudioAndRespond, nudgeStudent, cancelAiResponse, getRecordingBlob, setPlaybackRate };
}

function handleEvent(
  msg: Record<string, unknown>,
  callbacks: WebRTCCallbacks,
  getBuffer: () => string,
  setBuffer: (v: string) => void
) {
  const type = msg.type as string;

  switch (type) {
    // 학생 음성 → 텍스트 변환 완료
    case "conversation.item.input_audio_transcription.completed": {
      const text = msg.transcript as string;
      if (text?.trim()) {
        callbacks.onTranscript({ role: "user", text: text.trim() });
      }
      break;
    }

    // AI 응답 시작
    case "response.audio_transcript.delta": {
      const delta = msg.delta as string;
      if (delta) {
        if (getBuffer() === "") {
          callbacks.onAiSpeakingChange?.(true);
        }
        setBuffer(getBuffer() + delta);
      }
      break;
    }

    // AI 응답 텍스트 완료
    case "response.audio_transcript.done": {
      const text = (msg.transcript as string) || getBuffer();
      if (text?.trim()) {
        callbacks.onTranscript({ role: "assistant", text: text.trim() });
      }
      setBuffer("");
      callbacks.onAiSpeakingChange?.(false);
      break;
    }

    // 에러
    case "error": {
      const error = msg.error as { message?: string; code?: string } | undefined;
      // 취소할 응답이 없는 경우는 무시
      if (error?.message?.includes("no active response")) break;
      callbacks.onError(error?.message || "알 수 없는 오류가 발생했습니다");
      break;
    }
  }
}
