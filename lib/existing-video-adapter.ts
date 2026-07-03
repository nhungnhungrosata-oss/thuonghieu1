import type { VideoScript } from './video-script';

export type ExistingVideoScenePayload = {
  sceneNumber: number;
  duration: 8;
  model: 'veo-3.1-lite';
  script: string;
};

function buildSharedConsistencyPrompt(script: VideoScript) {
  const frameInstruction = script.aspectRatio === '16:9'
    ? 'Xuất video ngang 16:9 thật, lấp đầy toàn bộ khung từ mép đến mép.'
    : 'Xuất video dọc 9:16 thật, lấp đầy toàn bộ khung từ mép đến mép.';

  return [
    `VOICE CONSISTENCY LOCK: toàn bộ các cảnh phải dùng chính xác cùng một giọng ${script.region}.`,
    'Giữ nguyên cùng người nói, âm sắc, cao độ, tốc độ, nhịp nói, cách phát âm và phong cách thể hiện ở mọi cảnh.',
    'Mỗi cảnh là phần tiếp nối của cùng một lần ghi hình; không tự chọn lại giọng ở cảnh mới.',
    'REFERENCE IMAGE LOCK: dùng ảnh tải lên làm tham chiếu hình ảnh cố định cho toàn bộ video.',
    'Giữ nguyên nhân vật, khuôn mặt, tóc, trang phục, sản phẩm, màu sắc sản phẩm, bối cảnh, ánh sáng và phong cách hình ảnh.',
    frameInstruction,
    'Không đặt ảnh hoặc video nhỏ vào giữa một nền đen. Không tạo viền đen trên, dưới, trái hoặc phải; không letterbox và không pillarbox.',
    'Nếu tỷ lệ ảnh nguồn khác tỷ lệ video, chỉ được crop hoặc zoom rất nhẹ và mở rộng bối cảnh tự nhiên để lấp đầy khung, nhưng không làm biến dạng nhân vật hoặc sản phẩm.',
    'Chỉ tạo chuyển động nhẹ: môi khi nói, chớp mắt, biểu cảm, tay và cơ thể chuyển động tự nhiên.',
    'Không đổi cảnh, không đổi địa điểm, không đổi bối cảnh, không thêm người hoặc vật thể mới, không xuất hiện chữ, phụ đề, logo hay watermark.'
  ].join(' ');
}

/**
 * Chỉ chuẩn hóa dữ liệu thành chuỗi `script` cho pipeline cũ.
 * Không thay đổi upload ảnh, jobId, polling hoặc videoUrl.
 */
export function mapScriptScenesToExistingVideoPayload(script: VideoScript): ExistingVideoScenePayload[] {
  const sharedConsistencyPrompt = buildSharedConsistencyPrompt(script);

  return script.scenes.map((scene) => ({
    sceneNumber: scene.sceneNumber,
    duration: 8,
    model: 'veo-3.1-lite',
    script: [
      `Cảnh ${scene.sceneNumber}/${script.scenes.length}, thời lượng chính xác 8 giây.`,
      sharedConsistencyPrompt,
      `Mục tiêu cảnh: ${scene.objective.trim()}`,
      `Lời thoại tiếng Việt phải nói nguyên văn và nói hết trong cảnh: “${scene.voiceover.trim()}”`,
      `Giọng đọc bắt buộc: ${script.region}; cách nói tự nhiên, dễ hiểu, không dùng tiếng địa phương khó hiểu.`,
      `Biểu cảm chủ đạo: ${script.emotion}. Chi tiết biểu cảm: ${scene.facialExpression.trim()}`,
      `Hình ảnh và bối cảnh: ${scene.visualDescription.trim()}`,
      `Hành động nhân vật: ${scene.characterAction.trim()}`,
      `Góc máy và chuyển động camera: ${scene.camera.trim()}`,
      `Tỷ lệ bố cục mong muốn: ${script.aspectRatio}.`,
      `Chỉ dẫn video: ${scene.videoPrompt.trim()}`,
      'Các yêu cầu khóa giọng, khóa ảnh tham chiếu và lấp đầy khung phải được ưu tiên hơn mô tả riêng của từng cảnh.',
      'Không hiển thị văn bản, không logo, không watermark, không ký tự ngẫu nhiên và không render phụ đề trực tiếp vào video.'
    ].join(' ')
  }));
}
