import type { VideoAspectRatio, VideoEmotion, VideoRegion, VideoScript } from './video-script';

export type ExistingVideoScenePayload = {
  sceneNumber: number;
  duration: 8;
  model: 'veo-3.1-lite';
  script: string;
  aspectRatio: VideoAspectRatio;
  region: VideoRegion;
  emotion: VideoEmotion;
};

/**
 * Chỉ chuyển dữ liệu kịch bản AI sang trường `script` mà API /api/generate
 * hiện tại đang nhận. Hàm này không upload ảnh, không tạo job và không thay đổi
 * pipeline tạo video cũ.
 *
 * `aspectRatio`, `region`, `emotion` được trả kèm dưới dạng field riêng (không chỉ
 * nằm trong text) để phía client gửi thẳng, tường minh lên server thay vì để
 * server phải dò chữ trong `script` — tránh lệch giọng vùng miền và lệch tỷ lệ khung hình
 * giữa các cảnh.
 */
export function mapScriptScenesToExistingVideoPayload(script: VideoScript): ExistingVideoScenePayload[] {
  return script.scenes.map((scene) => ({
    sceneNumber: scene.sceneNumber,
    duration: 8,
    model: 'veo-3.1-lite',
    aspectRatio: script.aspectRatio,
    region: script.region,
    emotion: script.emotion,
    script: [
      `Cảnh ${scene.sceneNumber}/${script.scenes.length}, thời lượng chính xác 8 giây.`,
      `Mục tiêu cảnh: ${scene.objective.trim()}`,
      `Lời thoại tiếng Việt phải nói nguyên văn và nói hết trong cảnh: “${scene.voiceover.trim()}”`,
      `Giọng đọc bắt buộc: ${script.region}; cách nói tự nhiên, dễ hiểu, không dùng tiếng địa phương khó hiểu.`,
      `Biểu cảm chủ đạo: ${script.emotion}. Chi tiết biểu cảm: ${scene.facialExpression.trim()}`,
      `Hình ảnh và bối cảnh: ${scene.visualDescription.trim()}`,
      `Hành động nhân vật: ${scene.characterAction.trim()}`,
      `Góc máy và chuyển động camera: ${scene.camera.trim()}`,
      `Tỷ lệ bố cục mong muốn: ${script.aspectRatio}.`,
      `Chỉ dẫn video: ${scene.videoPrompt.trim()}`,
      'Giữ nguyên khuôn mặt, nhận diện, tuổi, tóc, trang phục và ngoại hình của nhân vật trong ảnh tham chiếu giữa mọi cảnh.',
      'Không hiển thị văn bản, không logo, không watermark, không ký tự ngẫu nhiên và không render phụ đề trực tiếp vào video.',
      `Chỉ dẫn riêng của cảnh về giọng ${script.region} và tỷ lệ ${script.aspectRatio} được ưu tiên áp dụng.`
    ].join(' ')
  }));
}
