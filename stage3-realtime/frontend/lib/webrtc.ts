export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

export interface WebRTCCallbacks {
  onConnected: () => void;
  /**
   * 누적된 전체 transcript를 OpenAI conversation item 생성 순서로 정렬해 전달.
   * (이전 버전은 도착 순서대로 push했으나, 학생 음성 transcription이 AI 응답
   * 완료 뒤에 도착하는 경우가 있어 학생/AI 발화 순서가 뒤바뀌는 문제 있었음)
   */
  onTranscript: (entries: TranscriptEntry[]) => void;
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
}

const REALTIME_API_URL = "https://api.openai.com/v1/realtime";
const MODEL = "gpt-4o-realtime-preview";

/**
 * Whisper가 무음/잡음에서 자주 만들어내는 환각 문구.
 * 학습 데이터의 유튜브 자막/방송 outro 흔적이 발화처럼 출력되는 현상.
 * 전체 문장이 패턴과 일치할 때만 필터 (부분 일치는 정상 발화 손실 위험).
 */
const HALLUCINATION_PATTERNS: RegExp[] = [
  // 유튜브 outro
  /^시청해[\s]*주셔서[\s]*(정말[\s]*)?감사합니다[.!?\s]*$/,
  /^구독과?[\s,]*좋아요([\s]*부탁드립니다)?[.!?\s]*$/,
  /^구독[\s,]*좋아요[.!?\s]*$/,
  /^다음[\s]*영상에서[\s]*(만나요|뵙겠습니다)[.!?\s]*$/,
  /^오늘[\s]*영상은[\s]*여기까지(입니다)?[.!?\s]*$/,
  /^영상[\s]*시청.*감사합니다[.!?\s]*$/,
  // 방송
  /^MBC[\s]*뉴스.*$/i,
  /^KBS[\s]*뉴스.*$/i,
  /^방송이[\s]*종료되었습니다[.!?\s]*$/,
  /^이[\s]*영상의?[\s]*자막은.*$/,
  // 영어 outro 흔적
  /^Thank[\s]*you[\s]*for[\s]*watching[.!?\s]*$/i,
  /^Thank[\s]*you[.!?\s]*$/i,           // 단독 "Thank you."
  /^Thanks[.!?\s]*$/i,
  /^Bye[\s.!?]*$/i,
  /^Goodbye[.!?\s]*$/i,
  /^Hello[.!?\s]*$/i,
  // gpt-4o-realtime이 무음 입력에 흔히 출력하는 메타 라벨
  /^\[?\s*Silence\s*\]?[.!?\s]*$/i,
  /^\[?\s*Music\s*\]?[.!?\s]*$/i,
  /^\[?\s*Inaudible\s*\]?[.!?\s]*$/i,
  /^\[?\s*Background\s*noise\s*\]?[.!?\s]*$/i,
  /^\(\s*silence\s*\).*$/i,
  // 단독 짧은 환각 빈출 문구
  /^감사합니다[.!?\s]*$/,
  /^안녕히[\s]*계세요[.!?\s]*$/,
  /^다음[\s]*시간에[\s]*뵙겠습니다[.!?\s]*$/,
];

function isHallucinatedTranscript(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return HALLUCINATION_PATTERNS.some((re) => re.test(trimmed));
}

export async function startWebRTC(
  ephemeralKey: string,
  callbacks: WebRTCCallbacks
): Promise<WebRTCSession> {
  const pc = new RTCPeerConnection();

  // AI 음성 출력용 audio element
  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;

  pc.ontrack = (event) => {
    audioEl.srcObject = event.streams[0];
  };

  // 마이크 입력 (기본 음소거)
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioTrack = stream.getTracks()[0];
  audioTrack.enabled = false; // PTT: 기본 음소거
  pc.addTrack(audioTrack);

  // DataChannel: OpenAI 이벤트 수신
  const dc = pc.createDataChannel("oai-events");

  // OpenAI conversation item id별로 슬롯을 잡아 생성 순서대로 transcript 유지
  // (도착 순서가 아니라 conversation 내 생성 순서가 진실)
  type Item = { role: "user" | "assistant"; text: string; order: number };
  const items = new Map<string, Item>();
  let orderCounter = 0;
  let aiSpeaking = false;

  const ensureItem = (id: string, role: "user" | "assistant"): Item => {
    let item = items.get(id);
    if (!item) {
      item = { role, text: "", order: orderCounter++ };
      items.set(id, item);
    }
    return item;
  };

  const emitTranscript = () => {
    const entries: TranscriptEntry[] = Array.from(items.values())
      .sort((a, b) => a.order - b.order)
      .filter((it) => it.text.trim())
      .map((it) => ({ role: it.role, text: it.text }));
    callbacks.onTranscript(entries);
  };

  dc.onopen = () => {
    callbacks.onConnected();
    // AI 선생님이 먼저 인사하도록 즉시 응답 생성 트리거
    // (마이크는 음소거 상태이므로 학생 입력 없이 AI만 말함)
    try {
      dc.send(JSON.stringify({ type: "response.create" }));
    } catch {
      // 송신 실패해도 연결 자체는 유지
    }
  };

  dc.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleEvent(msg, callbacks, ensureItem, emitTranscript, () => aiSpeaking, (v) => { aiSpeaking = v; });
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

  // 연결 해제 함수
  const disconnect = () => {
    stream.getTracks().forEach((t) => t.stop());
    dc.close();
    pc.close();
    audioEl.srcObject = null;
  };

  return { disconnect, setMicEnabled, commitAudioAndRespond, nudgeStudent, cancelAiResponse };
}

type EnsureItem = (id: string, role: "user" | "assistant") => { role: "user" | "assistant"; text: string; order: number };

function handleEvent(
  msg: Record<string, unknown>,
  callbacks: WebRTCCallbacks,
  ensureItem: EnsureItem,
  emit: () => void,
  getAiSpeaking: () => boolean,
  setAiSpeaking: (v: boolean) => void,
) {
  const type = msg.type as string;

  switch (type) {
    // 1) conversation에 새 item 등록 — 생성 순서를 여기서 확정한다
    case "conversation.item.created": {
      const item = msg.item as { id?: string; role?: string; type?: string } | undefined;
      if (item?.id && item.type === "message" && (item.role === "user" || item.role === "assistant")) {
        ensureItem(item.id, item.role);
      }
      break;
    }

    // 2) 학생 음성 → 텍스트 변환 완료 (도착이 늦어도 item_id로 올바른 슬롯 채움)
    case "conversation.item.input_audio_transcription.completed": {
      const itemId = msg.item_id as string | undefined;
      const text = (msg.transcript as string)?.trim();
      if (itemId && text && !isHallucinatedTranscript(text)) {
        ensureItem(itemId, "user").text = text;
        emit();
      }
      // 환각/빈 문구는 슬롯을 안 채워 emitTranscript의 filter에서 자동 제외됨
      break;
    }

    // 3) AI 응답 진행 중 — speaking indicator만 갱신, 텍스트는 done에서 한 번에
    case "response.audio_transcript.delta": {
      if (msg.delta && !getAiSpeaking()) {
        setAiSpeaking(true);
        callbacks.onAiSpeakingChange?.(true);
      }
      break;
    }

    // 4) AI 응답 완료 — item_id 기준으로 텍스트 확정
    case "response.audio_transcript.done": {
      const itemId = msg.item_id as string | undefined;
      const text = (msg.transcript as string)?.trim();
      if (itemId && text) {
        ensureItem(itemId, "assistant").text = text;
        emit();
      }
      if (getAiSpeaking()) {
        setAiSpeaking(false);
        callbacks.onAiSpeakingChange?.(false);
      }
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
