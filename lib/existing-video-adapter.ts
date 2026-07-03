import {
  VIDEO_REGIONS,
  getVideoRegionDisplayLabel,
  getVideoRegionPromptLabel,
  type VideoScript
} from './video-script';

export type ExistingVideoScenePayload = {
  sceneNumber: number;
  duration: 8;
  model: 'veo-3.1-lite';
  script: string;
};

function buildVoiceConsistencyLock(script: VideoScript) {
  const selectedVoice = getVideoRegionPromptLabel(script.region);
  const forbiddenVoices = VIDEO_REGIONS
    .filter((region) => region !== script.region)
    .map(getVideoRegionDisplayLabel)
    .join(' hoặc ');

  return [
    'VOICE PROFILE LOCK — HIGHEST PRIORITY, MANDATORY AND NON-NEGOTIABLE.',
    `Giọng được người dùng lựa chọn chính xác là: ${selectedVoice}.`,
    `Cụm từ này chỉ có nghĩa là giọng nói tiếng Việt của người Việt Nam thuộc đúng vùng miền đã chọn; không được hiểu là giọng Việt Nam chung chung, giọng mặc định hoặc giọng trung tính.`,
    `Tất cả các cảnh phải dùng duy nhất một người nói với chính xác ${selectedVoice}.`,
    'Phải giữ nguyên tuyệt đối danh tính giọng nói, giới tính cảm nhận, độ tuổi cảm nhận, âm sắc, cao độ, độ vang, tốc độ, nhịp điệu, cách ngắt câu, cách phát âm, năng lượng và phong cách nói trong mọi cảnh.',
    'Mỗi cảnh là phần tiếp theo của cùng một lần ghi âm liên tục bởi cùng một người nói; không được khởi tạo hoặc lựa chọn lại giọng ở cảnh mới.',
    `Nghiêm cấm sử dụng ${forbiddenVoices}, giọng Việt Nam mặc định, giọng trung tính, giọng pha trộn hoặc bất kỳ giọng vùng miền nào khác.`,
    'Không được chuyển giọng, trôi giọng, pha giọng, thay người nói, thay giới tính giọng, thay độ tuổi giọng, thay âm sắc, thay cao độ hoặc thay phong cách nói giữa các cảnh.',
    'Nếu bất kỳ mô tả nào khác mâu thuẫn với khóa giọng này, phải bỏ qua mô tả mâu thuẫn và luôn ưu tiên khóa giọng đã chọn.'
  ].join(' ');
}

function buildSharedConsistencyPrompt(script: VideoScript) {
  const frameInstruction = script.aspectRatio === '16:9'
    ? 'Xuất video ngang 16:9 thật, lấp đầy toàn bộ khung từ mép đến mép.'
    : 'Xuất video dọc 9:16 thật, lấp đầy toàn bộ khung từ mép đến mép.';

  return [
    buildVoiceConsistencyLock(script),
    'REFERENCE IMAGE LOCK — HIGHEST PRIORITY: dùng ảnh tải lên làm tham chiếu hình ảnh cố định cho toàn bộ video.',
    'Giữ nguyên tuyệt đối nhân vật, khuôn mặt, nhận diện, giới tính, độ tuổi, tóc, màu tóc, trang phục, sản phẩm, màu sắc sản phẩm, hình dáng sản phẩm, tỷ lệ cơ thể, bối cảnh, ánh sáng và phong cách hình ảnh.',
    frameInstruction,
    'Không đặt ảnh hoặc video nhỏ vào giữa nền đen. Không tạo viền đen trên, dưới, trái hoặc phải; không letterbox và không pillarbox.',
    'Nếu tỷ lệ ảnh nguồn khác tỷ lệ video, chỉ được crop hoặc zoom rất nhẹ và mở rộng bối cảnh tự nhiên để lấp đầy khung, nhưng không làm biến dạng nhân vật hoặc sản phẩm.',
    'Chỉ tạo chuyển động nhẹ: môi khi nói, chớp mắt, biểu cảm, tay và cơ thể chuyển động tự nhiên.',
    'Không đổi cảnh, không đổi địa điểm, không đổi bối cảnh, không thay nhân vật, không thay trang phục, không thay sản phẩm, không thêm người hoặc vật thể mới.',
    'Không xuất hiện văn bản, phụ đề, caption, logo, watermark hoặc ký tự ngẫu nhiên.'
  ].join(' ');
}

/**
 * Chỉ chuẩn hóa dữ liệu thành chuỗi `script` cho pipeline cũ.
 * Không thay đổi upload ảnh, jobId, polling hoặc videoUrl.
 */
export function mapScriptScenesToExistingVideoPayload(script: VideoScript): ExistingVideoScenePayload[] {
  const sharedConsistencyPrompt = buildSharedConsistencyPrompt(script);
  const selectedVoice = getVideoRegionPromptLabel(script.region);

  return script.scenes.map((scene) => ({
    sceneNumber: scene.sceneNumber,
    duration: 8,
    model: 'veo-3.1-lite',
    script: [
      `Cảnh ${scene.sceneNumber}/${script.scenes.length}, thời lượng chính xác 8 giây.`,
      sharedConsistencyPrompt,
      `Mục tiêu cảnh: ${scene.objective.trim()}`,
      `Lời thoại tiếng Việt phải nói nguyên văn và nói hết trong cảnh: “${scene.voiceover.trim()}”`,
      `GIỌNG ĐỌC BẮT BUỘC VÀ DUY NHẤT: ${selectedVoice}. Không được dùng bất kỳ giọng nào khác.`,
      `Biểu cảm chủ đạo: ${script.emotion}. Chi tiết biểu cảm: ${scene.facialExpression.trim()}`,
      `Hình ảnh và bối cảnh: ${scene.visualDescription.trim()}`,
      `Hành động nhân vật: ${scene.characterAction.trim()}`,
      `Góc máy và chuyển động camera: ${scene.camera.trim()}`,
      `Tỷ lệ bố cục mong muốn: ${script.aspectRatio}.`,
      `Chỉ dẫn video: ${scene.videoPrompt.trim()}`,
      'Các yêu cầu khóa giọng, khóa ảnh tham chiếu, khóa bối cảnh và lấp đầy khung phải được ưu tiên hơn mọi mô tả riêng của từng cảnh.',
      'Không hiển thị văn bản, không logo, không watermark, không ký tự ngẫu nhiên và không render phụ đề trực tiếp vào video.'
    ].join(' ')
  }));
}
