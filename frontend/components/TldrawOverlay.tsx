"use client";

import { useCallback, useEffect, useRef } from "react";
import { Tldraw, type Editor, type TLRecord } from "@tldraw/tldraw";
import "@tldraw/tldraw/tldraw.css";
import { Room, RoomEvent } from "livekit-client";

/**
 * 가상 좌표계 너비. 모든 참여자가 동일한 값을 사용해야 판서 위치가 일치한다.
 * overlayWidth / VIRTUAL_W = tldraw camera zoom 으로 변환된다.
 */
const VIRTUAL_W = 1920;

interface TldrawPatchMsg {
  type: "tldraw_patch";
  sender: string;
  added: TLRecord[];
  updated: TLRecord[];
  removed: string[];
}

const NullBackground = () => null;

const UI_OVERRIDES = {
  Background: NullBackground,
  MainMenu: null,
  NavigationPanel: null,
  HelpMenu: null,
  DebugPanel: null,
  SharePanel: null,
} as const;

export function TldrawOverlay({
  room,
  senderName,
  overlayWidth, // 영상 실제 렌더 영역의 너비(px) — 없으면 컨테이너 너비 사용
  onEditorMount,
}: {
  room: Room;
  senderName: string;
  overlayWidth?: number;
  onEditorMount?: (editor: Editor) => void;
}) {
  const editorRef = useRef<Editor | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      onEditorMount?.(editor);

      // 카메라 zoom = overlayWidth / VIRTUAL_W 로 설정해
      // 모든 참여자가 동일한 가상 좌표 공간을 공유하도록 한다.
      const w = overlayWidth ?? containerRef.current?.clientWidth ?? VIRTUAL_W;
      const zoom = w / VIRTUAL_W;
      editor.setCamera({ x: 0, y: 0, z: zoom });
      editor.setCameraOptions({ isLocked: true });

      // 로컬 변경사항을 DataChannel로 브로드캐스트 (shape 레코드만)
      editor.store.listen(
        (entry) => {
          if (entry.source !== "user") return;
          const { added, updated, removed } = entry.changes;

          const addedArr = (Object.values(added) as TLRecord[]).filter(
            (r) => r.typeName === "shape"
          );
          const updatedArr = (Object.values(updated) as [TLRecord, TLRecord][])
            .map(([, next]) => next)
            .filter((r) => r.typeName === "shape");
          const removedIds = Object.entries(removed)
            .filter(([, r]) => (r as TLRecord).typeName === "shape")
            .map(([id]) => id);

          if (!addedArr.length && !updatedArr.length && !removedIds.length) return;

          const msg: TldrawPatchMsg = {
            type: "tldraw_patch",
            sender: senderName,
            added: addedArr,
            updated: updatedArr,
            removed: removedIds,
          };
          room.localParticipant.publishData(
            new TextEncoder().encode(JSON.stringify(msg)),
            { reliable: true }
          );
        },
        { source: "user" }
      );
    },
    [room, senderName, overlayWidth, onEditorMount]
  );

  // overlayWidth가 바뀔 때마다(영상 메타데이터 로드, 창 크기 변경 등)
  // 카메라 zoom을 다시 맞춰 가상 좌표계를 유지한다.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !overlayWidth) return;
    const zoom = overlayWidth / VIRTUAL_W;
    editor.setCameraOptions({ isLocked: false });
    editor.setCamera({ x: 0, y: 0, z: zoom });
    editor.setCameraOptions({ isLocked: true });
  }, [overlayWidth]);

  // 원격 판서 패치 수신
  useEffect(() => {
    const handler = (payload: Uint8Array) => {
      try {
        const msg: TldrawPatchMsg = JSON.parse(new TextDecoder().decode(payload));
        if (msg.type !== "tldraw_patch") return;
        if (msg.sender === senderName) return;

        const editor = editorRef.current;
        if (!editor) return;

        editor.store.mergeRemoteChanges(() => {
          const records = [...(msg.added ?? []), ...(msg.updated ?? [])];
          if (records.length) editor.store.put(records);
          if (msg.removed?.length) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            editor.store.remove(msg.removed as any);
          }
        });
      } catch {}
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => {
      room.off(RoomEvent.DataReceived, handler);
    };
  }, [room, senderName]);

  return (
    // zIndex: 1 로 stacking context를 격리 — tldraw 내부 z-index(300 등)가
    // 외부 컨트롤 버튼(z-[9999])을 가리지 않도록 한다.
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "auto",
        zIndex: 1,
      }}
    >
      <style>{`
        .tl-container { background: transparent !important; }
        .tl-canvas { background: transparent !important; }
      `}</style>
      <Tldraw
        onMount={handleMount}
        components={UI_OVERRIDES as Parameters<typeof Tldraw>[0]["components"]}
      />
    </div>
  );
}
