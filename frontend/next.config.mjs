/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",            // static HTML/JS -> served by FastAPI (zero runtime overhead)
  images: { unoptimized: true },
  trailingSlash: true,
};
export default nextConfig;
