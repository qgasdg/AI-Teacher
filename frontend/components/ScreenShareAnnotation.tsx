"use client";

import React, { useEffect, useRef, useCallback, useState } from "react";
import { VideoTrack } from "@livekit/components-react";
import { Room } from "livekit-client";
import type { Editor } from "@tldraw/tldraw";
import dynamic from "next/dynamic";

const TldrawOverlay = dynamic(
  () => import("@/components/TldrawOverlay").then((m) => m.TldrawOverlay),
  { ssr: false }
);

/**
 * object-contain 으로 표시된 영상의 실제 렌더 영역(letterbox/pillarbox 제외)을 계산해
 * tldraw 오버레이를 그 영역에만 겹치도록 배치한다.
 *
 * 이렇게 하면 학생/선생님 컨테이너 크기가 달라도
 * 동일한 가상 좌표계(VIRTUAL_W × VIRTUAL_H)를 공유할 수 있어 판서 위치가 일치한다.
 */
export function ScreenShareAnnotation({
  trackRef,
  room,
  senderName,
  onEditorMount,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trackRef: any;
  room: Room;
  senderName: string;
  onEditorMount?: (ed: Editor) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const [overlayRect, setOverlayRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  const recalculate = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (!cw || !ch) return;

    const video = videoElRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      // 영상 메타데이터 로드 전 → 컨테이너 전체 커버
      setOverlayRect({ top: 0, left: 0, width: cw, height: ch });
      return;
    }

    const va = video.videoWidth / video.videoHeight;
    const ca = cw / ch;

    let left: number, top: number, width: number, height: number;
    if (va > ca) {
      // 가로가 더 넓음 → 위아래 레터박스
      width = cw;
      height = cw / va;
      left = 0;
      top = (ch - height) / 2;
    } else {
      // 세로가 더 길음 → 좌우 필러박스
      height = ch;
      width = ch * va;
      left = (cw - width) / 2;
      top = 0;
    }

    setOverlayRect({ top, left, width, height });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // LiveKit가 비동기로 <video> 를 삽입하므로 폴링으로 감지
    const attachVideo = () => {
      const v = container.querySelector<HTMLVideoElement>("video");
      if (v && v !== videoElRef.current) {
        videoElRef.current = v;
        v.addEventListener("loadedmetadata", recalculate);
        recalculate();
      }
    };
    const interval = setInterval(attachVideo, 200);
    attachVideo();

    const ro = new ResizeObserver(recalculate);
    ro.observe(container);

    return () => {
      clearInterval(interval);
      ro.disconnect();
      videoElRef.current?.removeEventListener("loadedmetadata", recalculate);
    };
  }, [recalculate]);

  return (
    <div ref={containerRef} className="absolute inset-0 bg-black">
      {/* 화면 공유 영상 — 포인터 이벤트 없음 */}
      <VideoTrack
        trackRef={trackRef}
        className="absolute inset-0 w-full h-full object-contain"
        style={{ pointerEvents: "none" } as React.CSSProperties}
      />

      {/* tldraw 오버레이: 영상 실제 렌더 영역에만 배치 */}
      {overlayRect && (
        <div
          style={{
            position: "absolute",
            top: overlayRect.top,
            left: overlayRect.left,
            width: overlayRect.width,
            height: overlayRect.height,
          }}
        >
          <TldrawOverlay
            room={room}
            senderName={senderName}
            overlayWidth={overlayRect.width}
            onEditorMount={onEditorMount}
          />
        </div>
      )}
    </div>
  );
}
