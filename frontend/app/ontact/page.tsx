"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import {
  LiveKitRoom,
  useParticipants,
  useLocalParticipant,
  useRoomContext,
  VideoTrack,
  AudioTrack,
  useTracks,
} from "@livekit/components-react";
import { Track, RoomEvent } from "livekit-client";
import type { Editor } from "@tldraw/tldraw";
import dynamic from "next/dynamic";

const ScreenShareAnnotation = dynamic(
  () => import("@/components/ScreenShareAnnotation").then((m) => m.ScreenShareAnnotation),
  { ssr: false }
);

// ── 타입 ──────────────────────────────────────────────────────

interface ChatMsg {
  sender: string;
  content: string;
  image_url?: string;
  ts: number;
}

interface DataMsg {
  type: "chat" | "room_switch" | "entered_private" | "left_private";
  sender: string;
  to: string | null;
  content: string;
  image_url?: string;
  target_room?: "group" | "private";
}

type RoomType = "group" | "private";

// ── 메인 페이지 ───────────────────────────────────────────────

export default function OntactPage() {
  const [phase, setPhase] = useState<"form" | "joining" | "room" | "done">("form");
  const [studentName, setStudentName] = useState("");
  const [formError, setFormError] = useState("");
  const [classroomId, setClassroomId] = useState<number | null>(null);
  const [token, setToken] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [roomType, setRoomType] = useState<RoomType>("group");
  const [roomKey, setRoomKey] = useState(0);
  const [roomConnecting, setRoomConnecting] = useState(false);

  // 녹음기는 방 전환에도 유지되도록 부모에서 관리
  const chunksRef = useRef<Blob[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (phase !== "room") return;
    let recorder: MediaRecorder;
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.start(5000);
      recorderRef.current = recorder;
    }).catch((err) => console.warn("녹음 시작 실패:", err));
    return () => {
      recorder?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [phase]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = studentName.trim();
    if (!name) { setFormError("이름을 입력해주세요."); return; }
    setFormError("");
    setPhase("joining");

    try {
      // 열린 교실이 없으면 자동 생성 (학생 선입장 허용)
      const classroomRes = await apiFetch("/ontact/classrooms/ensure-open", {
        method: "POST",
      });
      if (!classroomRes.ok) {
        setFormError("입장 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
        setPhase("form");
        return;
      }
      const { id: cid } = await classroomRes.json();
      setClassroomId(cid);

      const tokenRes = await apiFetch(
        `/ontact/token?classroom_id=${cid}&name=${encodeURIComponent(name)}&room_type=group&want=student`
      );
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        setFormError(err.detail || "입장 중 오류가 발생했습니다.");
        setPhase("form");
        return;
      }
      const { token: lvToken, livekit_url, session_id } = await tokenRes.json();
      setToken(lvToken);
      setServerUrl(livekit_url);
      setSessionId(session_id);
      setRoomType("group");
      setPhase("room");
    } catch {
      setFormError("연결 중 오류가 발생했습니다.");
      setPhase("form");
    }
  };

  const switchRoom = useCallback(async (newRoomType: RoomType) => {
    if (!classroomId) return;
    const params = new URLSearchParams({
      classroom_id: String(classroomId),
      name: studentName,
      room_type: newRoomType,
      want: "student",
    });
    const tokenRes = await apiFetch(`/ontact/token?${params}`);
    if (!tokenRes.ok) return;
    const { token: newToken, livekit_url } = await tokenRes.json();
    const scrollY = window.scrollY;
    setRoomConnecting(true);
    await new Promise((r) => setTimeout(r, 200));
    setToken(newToken);
    setServerUrl(livekit_url);
    setRoomType(newRoomType);
    setRoomKey((k) => k + 1);
    setRoomConnecting(false);
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  }, [classroomId, studentName]);

  const handleLeave = useCallback(async () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    if (blob.size > 0 && sessionId) {
      const form = new FormData();
      form.append("audio", blob, "recording.webm");
      await apiFetch(`/ontact/student-sessions/${sessionId}/complete`, {
        method: "POST",
        body: form,
      }).catch((e) => console.error("오디오 업로드 실패:", e));
    }
    setPhase("done");
  }, [sessionId]);

  if (phase === "form" || phase === "joining") {
    return (
      <div className="max-w-md mx-auto px-4 py-16">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">온택트 교실</h1>
        <p className="text-sm text-gray-500 mb-8">이름을 입력하고 수업에 입장하세요.</p>
        <form onSubmit={handleJoin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">이름</label>
            <input
              type="text"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="예: 홍길동"
              disabled={phase === "joining"}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>
          {formError && <p className="text-sm text-red-500">{formError}</p>}
          <button
            type="submit"
            disabled={phase === "joining"}
            className="w-full bg-purple-600 text-white rounded-xl py-3 font-semibold hover:bg-purple-700 transition disabled:opacity-50"
          >
            {phase === "joining" ? "입장 중..." : "교실 입장"}
          </button>
        </form>
        <p className="mt-6 text-xs text-gray-400 text-center">
          입장하면 수업 녹음이 자동으로 시작됩니다.
        </p>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <p className="text-2xl font-bold text-gray-800 mb-3">수업이 종료되었습니다</p>
        <p className="text-sm text-gray-500 mb-8">수고하셨습니다.</p>
        <a
          href="/"
          className="inline-block bg-purple-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-purple-700 transition"
        >
          메인으로
        </a>
      </div>
    );
  }

  if (roomConnecting) {
    return (
      <div className="flex h-[calc(100vh-57px)] bg-gray-900 items-center justify-center">
        <p className="text-sm text-gray-400">방 이동 중...</p>
      </div>
    );
  }

  return (
    <LiveKitRoom
      key={roomKey}
      token={token}
      serverUrl={serverUrl}
      audio={true}
      video={false}
      connect={true}
    >
      <StudentRoom
        studentName={studentName}
        classroomId={classroomId!}
        sessionId={sessionId}
        roomType={roomType}
        onSwitchRoom={switchRoom}
        onLeave={handleLeave}
      />
    </LiveKitRoom>
  );
}

// ── 학생 방 UI ────────────────────────────────────────────────

function StudentRoom({
  studentName,
  classroomId,
  sessionId,
  roomType,
  onSwitchRoom,
  onLeave,
}: {
  studentName: string;
  classroomId: number;
  sessionId: number | null;
  roomType: RoomType;
  onSwitchRoom: (type: RoomType) => void;
  onLeave: () => void;
}) {
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const participants = useParticipants();
  const teacher = participants.find((p) => p.identity === "teacher");

  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [leaving, setLeaving] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const tldrawEditorRef = useRef<Editor | null>(null);

  // DataChannel 수신 (채팅 + 방 이동 알림)
  useEffect(() => {
    const handler = (payload: Uint8Array) => {
      try {
        const msg: DataMsg = JSON.parse(new TextDecoder().decode(payload));
        if (msg.type === "room_switch" && msg.target_room) {
          onSwitchRoom(msg.target_room);
          return;
        }
        if (msg.type !== "chat") return;
        if (msg.to !== null && msg.to !== studentName) return;
        setMsgs((prev) => [...prev, {
          sender: msg.sender,
          content: msg.content,
          image_url: msg.image_url,
          ts: Date.now(),
        }]);
      } catch {}
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room, studentName, onSwitchRoom]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const msg: DataMsg = { type: "chat", sender: studentName, to: null, content: text };
    room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(msg)),
      { reliable: true }
    );
    setMsgs((prev) => [...prev, { sender: "나", content: text, ts: Date.now() }]);
    setInput("");
    // DB 저장 (fire-and-forget)
    apiFetch(`/ontact/classrooms/${classroomId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: studentName, to_student: null, content: text, student_session_id: sessionId }),
    }).catch(() => {});
  }, [input, room, studentName, classroomId, sessionId]);

  const sendImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const msg: DataMsg = { type: "chat", sender: studentName, to: null, content: "[사진]", image_url: dataUrl };
      room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify(msg)),
        { reliable: true }
      );
      setMsgs((prev) => [...prev, { sender: "나", content: "[사진]", image_url: dataUrl, ts: Date.now() }]);
    };
    reader.readAsDataURL(file);
  };

  const handleLeave = async () => {
    if (leaving) return;
    setLeaving(true);
    room.disconnect();
    await onLeave();
  };

  // 선생님이 교실을 닫으면 서버가 LiveKit 방을 삭제 → 연결이 끊긴다.
  // 이때 자동으로 수업 종료 처리 (녹음 업로드 → 완료 화면).
  // 방 전환 시에는 언마운트 cleanup이 먼저 리스너를 제거하므로 발동하지 않는다.
  useEffect(() => {
    const onDisconnected = () => {
      if (!leaving) {
        setLeaving(true);
        onLeave();
      }
    };
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => { room.off(RoomEvent.Disconnected, onDisconnected); };
  }, [room, leaving, onLeave]);

  const allCameraTracks = useTracks([Track.Source.Camera]);
  const allMicTracks = useTracks([Track.Source.Microphone]);
  const allScreenShareTracks = useTracks([Track.Source.ScreenShare]);

  // 카메라를 끄면 publication이 muted로 남아 검은 잔상이 생긴다 → 실제 송출 중인 트랙만.
  const isLive = (t: (typeof allCameraTracks)[number]) =>
    !!t.publication && !t.publication.isMuted && !!t.publication.track;
  const teacherVideoTracks = allCameraTracks.filter(
    (t) => t.participant.identity === "teacher" && isLive(t)
  );
  const localVideoTracks = allCameraTracks.filter(
    (t) => t.participant.identity === room.localParticipant.identity && isLive(t)
  );
  const remoteAudioTracks = allMicTracks.filter(
    (t) => t.participant.identity !== room.localParticipant.identity
  );
  // 화면 공유 트랙 (로컬/원격 중 첫 번째)
  const activeScreenShare = allScreenShareTracks[0] ?? null;

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* 비디오 영역 */}
      <div className="flex-1 bg-gray-900 relative overflow-hidden flex items-center justify-center">
        {activeScreenShare ? (
          /* ── 화면 공유 모드: 영상 + tldraw 오버레이 ── */
          <>
            <ScreenShareAnnotation
              trackRef={activeScreenShare}
              room={room}
              senderName={studentName}
              onEditorMount={(ed) => { tldrawEditorRef.current = ed; }}
            />
            {/* 판서 지우기 버튼 (우상단) */}
            <button
              onClick={() => {
                const ed = tldrawEditorRef.current;
                if (!ed) return;
                const ids = [...ed.getCurrentPageShapeIds()];
                if (ids.length) ed.deleteShapes(ids);
              }}
              className="absolute top-4 right-4 z-[9999] text-xs px-3 py-1.5 rounded-full bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm transition font-medium"
            >
              판서 지우기
            </button>
          </>
        ) : (
          /* ── 일반 모드: 선생님 영상 ── */
          <>
            {teacherVideoTracks.length > 0 ? (
              <VideoTrack
                trackRef={teacherVideoTracks[0]}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-gray-500">
                <div className="w-20 h-20 rounded-full bg-gray-700 flex items-center justify-center text-3xl">👨‍🏫</div>
                <p className="text-sm">{teacher ? "선생님 (카메라 꺼짐)" : "선생님 입장 대기 중..."}</p>
              </div>
            )}
            {/* 내 카메라 (우하단 PIP) */}
            {isCameraEnabled && localVideoTracks.length > 0 && (
              <div className="absolute bottom-4 right-4 w-32 h-24 rounded-xl overflow-hidden border-2 border-white shadow-lg">
                {localVideoTracks.map((t) => (
                  <VideoTrack key={t.publication.trackSid} trackRef={t} className="w-full h-full object-cover" />
                ))}
              </div>
            )}
          </>
        )}

        {/* 원격 오디오 재생 (항상) */}
        {remoteAudioTracks.map((t) => (
          <AudioTrack key={t.publication.trackSid} trackRef={t} />
        ))}

        {/* 현재 방 + 전환 버튼 (좌상단) */}
        <div className="absolute top-4 left-4 z-[9999] flex items-center gap-2">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
            roomType === "group"
              ? "bg-purple-500/80 text-white"
              : "bg-amber-500/80 text-white"
          }`}>
            {roomType === "group" ? "강의실" : "개인실"}
          </span>
          <button
            onClick={async () => {
              const targetRoom = roomType === "group" ? "private" : "group";
              const notifyType = targetRoom === "private" ? "entered_private" : "left_private";
              const msg: DataMsg = { type: notifyType, sender: studentName, to: null, content: "" };
              room.localParticipant.publishData(
                new TextEncoder().encode(JSON.stringify(msg)),
                { reliable: true }
              );
              await new Promise((r) => setTimeout(r, 150));
              onSwitchRoom(targetRoom);
            }}
            className="text-xs px-3 py-1.5 rounded-full bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm transition font-medium"
          >
            {roomType === "group" ? "개인실로 →" : "← 강의실로"}
          </button>
        </div>

        {/* 컨트롤 바 */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3">
          <button
            onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
            className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg text-white text-lg transition ${
              isCameraEnabled ? "bg-gray-700 hover:bg-gray-600" : "bg-red-500 hover:bg-red-600"
            }`}
          >
            {isCameraEnabled ? "📷" : "📵"}
          </button>
          <button
            onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
            className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg text-white text-lg transition ${
              isMicrophoneEnabled ? "bg-gray-700 hover:bg-gray-600" : "bg-red-500 hover:bg-red-600"
            }`}
          >
            {isMicrophoneEnabled ? "🎙" : "🔇"}
          </button>
          <button
            onClick={() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled)}
            className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg text-white text-lg transition ${
              isScreenShareEnabled ? "bg-blue-500 hover:bg-blue-600" : "bg-gray-700 hover:bg-gray-600"
            }`}
            title={isScreenShareEnabled ? "화면 공유 중지" : "화면 공유"}
          >
            🖥
          </button>
          <button
            onClick={handleLeave}
            disabled={leaving}
            className="px-5 h-12 rounded-full bg-red-500 hover:bg-red-600 text-white font-semibold shadow-lg transition disabled:opacity-50"
          >
            {leaving ? "나가는 중..." : "나가기"}
          </button>
        </div>
      </div>

      {/* 채팅 패널 */}
      <div className="w-72 bg-white border-l border-gray-200 flex flex-col">
        {/* 참여자 목록 */}
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-2">
            참여자 <span className="text-purple-600">{participants.length}명</span>
          </p>
          <ul className="space-y-1">
            {participants.map((p) => {
              const isTeacher = p.identity === "teacher";
              const isMe = p.identity === room.localParticipant.identity;
              return (
                <li key={p.identity} className="flex items-center gap-2 text-xs text-gray-600">
                  <span className={`w-1.5 h-1.5 rounded-full ${isTeacher ? "bg-purple-500" : "bg-green-500"}`} />
                  <span className={isTeacher ? "font-medium text-gray-800" : ""}>
                    {isTeacher ? "선생님" : p.name || p.identity}
                    {isMe && <span className="text-gray-400"> (나)</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-700">채팅</div>
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {msgs.length === 0 && (
            <p className="text-xs text-gray-400 text-center mt-4">메시지를 입력하세요</p>
          )}
          {msgs.map((msg, i) => {
            const isMe = msg.sender === "나";
            return (
              <div key={i} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                {!isMe && <p className="text-xs text-gray-400 mb-0.5 ml-1">{msg.sender}</p>}
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  isMe ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-800"
                }`}>
                  {msg.image_url && (
                    <img src={msg.image_url} alt="사진" className="rounded mb-1 max-w-full" />
                  )}
                  {msg.content !== "[사진]" && msg.content}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        <div className="px-3 py-2 border-t border-gray-100 flex gap-2">
          <button
            onClick={() => imgRef.current?.click()}
            className="text-gray-400 hover:text-gray-600 text-lg shrink-0"
          >
            🖼
          </button>
          <input ref={imgRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) sendImage(f); e.target.value = ""; }}
          />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && (e.preventDefault(), sendMessage())}
            placeholder="메시지 입력..."
            className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim()}
            className="shrink-0 bg-purple-600 text-white rounded-xl px-3 py-2 text-sm hover:bg-purple-700 transition disabled:opacity-40"
          >
            전송
          </button>
        </div>
      </div>
    </div>
  );
}
