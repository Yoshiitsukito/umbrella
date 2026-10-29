# Builds the launcher, splash and status-bar icons from the UMBRELLA logo.
param([string]$Logo)
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root "assets"
New-Item -ItemType Directory -Force -Path $assets | Out-Null
$source = [System.Drawing.Bitmap]::FromFile($Logo)

function Save-Canvas([int]$size, [double]$scale, [string]$background, [string]$path) {
  $canvas = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($canvas)
  $g.SmoothingMode = "HighQuality"; $g.InterpolationMode = "HighQualityBicubic"; $g.PixelOffsetMode = "HighQuality"
  if ($background) { $g.Clear([System.Drawing.ColorTranslator]::FromHtml($background)) } else { $g.Clear([System.Drawing.Color]::Transparent) }
  $side = [int]($size * $scale); $offset = [int](($size - $side) / 2)
  $g.DrawImage($source, $offset, $offset, $side, $side)
  $g.Dispose(); $canvas.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $canvas.Dispose()
}

Save-Canvas 1024 1.0 $null (Join-Path $assets "logo.png")
Save-Canvas 1024 0.78 "#0b0b0d" (Join-Path $assets "icon.png")
Save-Canvas 1024 0.62 $null (Join-Path $assets "icon_foreground.png")

# Status-bar icon: the red panels become white on transparent, as Android draws it in one colour.
$res = Join-Path $root "android\app\src\main\res"
foreach ($density in @{ "mdpi" = 24; "hdpi" = 36; "xhdpi" = 48; "xxhdpi" = 72; "xxxhdpi" = 96 }.GetEnumerator()) {
  $size = $density.Value
  $small = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($small)
  $g.InterpolationMode = "HighQualityBicubic"; $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($source, 0, 0, $size, $size); $g.Dispose()
  for ($x = 0; $x -lt $size; $x++) {
    for ($y = 0; $y -lt $size; $y++) {
      $p = $small.GetPixel($x, $y)
      $red = $p.A -gt 60 -and $p.R -gt 150 -and $p.G -lt 110 -and $p.B -lt 110
      $small.SetPixel($x, $y, $(if ($red) { [System.Drawing.Color]::FromArgb($p.A, 255, 255, 255) } else { [System.Drawing.Color]::Transparent }))
    }
  }
  $dir = Join-Path $res ("drawable-" + $density.Key)
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $small.Save((Join-Path $dir "ic_stat_umbrella.png"), [System.Drawing.Imaging.ImageFormat]::Png); $small.Dispose()
}
$source.Dispose()
"icons ready"
