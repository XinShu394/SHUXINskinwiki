$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$folder = "d:\港科广\自学\砖皮鉴赏\砖皮百科\SCARH\J拳皇"

function Crop([string]$src, [string]$dst, [double]$leftPct, [double]$topPct, [double]$rightPct, [double]$bottomPct) {
  $bmp = New-Object System.Drawing.Bitmap($src)
  try {
    $w = $bmp.Width
    $h = $bmp.Height
    $left = [int][Math]::Round($w * $leftPct)
    $top = [int][Math]::Round($h * $topPct)
    $right = [int][Math]::Round($w * $rightPct)
    $bottom = [int][Math]::Round($h * $bottomPct)
    $cropW = $w - $left - $right
    $cropH = $h - $top - $bottom
    $rect = New-Object System.Drawing.Rectangle($left, $top, $cropW, $cropH)
    $cropped = $bmp.Clone($rect, $bmp.PixelFormat)
    try {
      $cropped.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $cropped.Dispose()
    }
  } finally {
    $bmp.Dispose()
  }
}

Crop (Join-Path $folder "Delta Force Screenshot 2026.05.29 - 09.44.14.45.png") (Join-Path $folder "SCARH-拳皇-001_B.png") 0.15 0.10 0.06 0.18
Crop (Join-Path $folder "Delta Force Screenshot 2026.05.29 - 09.44.20.26.png") (Join-Path $folder "SCARH-拳皇-001_C.png") 0.0 0.022 0.0 0.0
Crop (Join-Path $folder "Delta Force Screenshot 2026.05.29 - 09.44.24.10.png") (Join-Path $folder "SCARH-拳皇-001_D.png") 0.0 0.022 0.0 0.0

Write-Output "Fixed SCARH J拳皇 B/C/D mapping."
