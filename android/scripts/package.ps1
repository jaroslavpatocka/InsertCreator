$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$androidRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$archivePath = Join-Path $androidRoot 'artifacts\InsertCreator-Android.zip'
$packageItems = @()
foreach ($name in @('.gitattributes','.gitignore','AGENTS.md','build.gradle','app/build.gradle','settings.gradle','gradle.properties','gradlew','gradlew.bat','BUILD.cmd','README.md','VERIFICATION.md','validate.gradle')) {
    $packageItems += @{ name=$name; source=(Join-Path $androidRoot $name) }
}
function Add-SourceDirectory($directory) {
    foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked paths are not permitted in the source package' }
        if ($item.PSIsContainer) { Add-SourceDirectory $item.FullName }
        else {
            $relative = $item.FullName.Substring($androidRoot.Length + 1).Replace('\','/')
            if ($relative -match '(?i)\.(keystore|jks)$|(^|/)keystore\.properties$') { throw 'Private signing material cannot be packaged' }
            $script:packageItems += @{ name=$relative; source=$item.FullName }
        }
    }
}
foreach ($directory in @('app\src','gradle','scripts','play')) { Add-SourceDirectory (Join-Path $androidRoot $directory) }
$packageItems += @{ name='builds/InsertCreator-debug.apk'; source=(Join-Path $androidRoot 'app\build\outputs\apk\debug\app-debug.apk') }
$packageItems += @{ name='builds/InsertCreator-release-unsigned.aab'; source=(Join-Path $androidRoot 'app\build\outputs\bundle\release\app-release.aab') }
$packageItems += @{ name='verification.json'; source=(Join-Path $androidRoot 'artifacts\android-verification.json') }
if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($archivePath)) -ne (Join-Path $androidRoot 'artifacts')) { throw 'Archive outside artifacts' }
$stream = [IO.File]::Open($archivePath,[IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($item in $packageItems) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$item.source,$item.name,[IO.Compression.CompressionLevel]::Optimal) | Out-Null }
} finally { $archive.Dispose(); $stream.Dispose() }
$reader = [IO.Compression.ZipFile]::OpenRead($archivePath)
$verified = @()
try {
    if ($reader.Entries.Count -ne $packageItems.Count) { throw 'Wrong ZIP entry count' }
    foreach ($item in $packageItems) {
        $entry = $reader.GetEntry($item.name)
        $inputStream = $entry.Open(); $sha = [Security.Cryptography.SHA256]::Create()
        try { $entryHash = [BitConverter]::ToString($sha.ComputeHash($inputStream)).Replace('-','') }
        finally { $sha.Dispose(); $inputStream.Dispose() }
        if ($entryHash -ne (Get-FileHash -LiteralPath $item.source -Algorithm SHA256).Hash) { throw "ZIP bytes differ: $($item.name)" }
        $verified += [ordered]@{name=$item.name; bytes=$entry.Length; sha256=$entryHash}
    }
} finally { $reader.Dispose() }
$receipt = [ordered]@{created=[DateTime]::UtcNow.ToString('o'); file='artifacts/InsertCreator-Android.zip'; bytes=(Get-Item -LiteralPath $archivePath).Length; sha256=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash; entries=$verified; signedForProduction=$false; publishedToGooglePlay=$false}
$json = $receipt | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $androidRoot 'artifacts\android-package.json'),$json + "`n",[Text.UTF8Encoding]::new($false))
Write-Output ("Verified Android ZIP: {0} files, {1} bytes, SHA-256 {2}" -f $verified.Count,$receipt.bytes,$receipt.sha256)
