/**
 * The Recoil engine's mark, as a nav icon. The three shapes are the ones in
 * RecoilEngine's own `rts/RecoilEngine_Icon.svg`, filled with the text colour
 * instead of white and with the drop shadows left off, and cropped to the mark.
 *
 * Matches `IconComponent` from the plugin SDK (`size` and `className`), so it
 * goes anywhere a lucide icon does.
 */
export function RecoilGlyph({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="47 68 340 340"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M261.912 115.162C258.771 114.96 255.603 114.857 252.412 114.857C172.054 114.857 106.912 179.999 106.912 260.357C106.912 340.714 172.054 405.857 252.412 405.857C255.603 405.857 258.771 405.754 261.912 405.552C185.982 400.658 125.912 337.523 125.912 260.357C125.912 183.191 185.982 120.056 261.912 115.162Z"
      />
      <path d="M365.5 131.862C363.116 129.149 360.629 126.495 358.039 123.905C292.832 58.6984 187.112 58.6983 121.905 123.905C56.6983 189.112 56.6983 294.832 121.905 360.039C124.495 362.629 127.149 365.116 129.861 367.5C72.2189 301.916 74.706 201.939 137.323 139.323C199.939 76.706 299.916 74.2189 365.5 131.862Z" />
      <path d="M322.237 337.403L277.413 284H320.95L356.552 326.036V337.403H322.237ZM202.348 337.403V183.199H324.811C330.673 183.199 335.963 184.629 340.681 187.488C345.543 190.348 349.403 194.208 352.263 199.07C355.265 203.931 356.767 209.221 356.767 214.94V254.832C356.767 260.551 355.265 265.841 352.263 270.702C349.403 275.564 345.543 279.424 340.681 282.284C335.963 285.143 330.673 286.573 324.811 286.573L235.591 286.788V337.403H202.348ZM235.591 253.116H323.095V216.442H235.591V253.116Z" />
    </svg>
  );
}
