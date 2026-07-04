/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingExcludes: { '*': ['./node_modules/**/*'] },
  ...(process.env.SKIP_FFMPEG_TRACE === '1' ? {} : {
    outputFileTracingIncludes: {
      '/api/video/merge': ['./.ffmpeg/**/*']
    }
  }),
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb'
    },
    cpus: 1,
    workerThreads: false
  }
};

export default nextConfig;
