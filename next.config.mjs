/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' }
    ]
  },

  // Giữ ffmpeg-static là package phía server để đường dẫn binary không bị
  // webpack thay đổi, đồng thời buộc Vercel mang file binary vào function.
  serverExternalPackages: ['ffmpeg-static'],
  outputFileTracingIncludes: {
    '/api/video/merge': [
      './.ffmpeg/**/*',
      './node_modules/ffmpeg-static/ffmpeg',
      './node_modules/ffmpeg-static/ffmpeg.exe',
      './node_modules/ffmpeg-static/package.json'
    ]
  }
};

export default nextConfig;
