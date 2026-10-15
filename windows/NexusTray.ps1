#Requires -Version 5.1
<#
.SYNOPSIS
    Nexus Windows System Tray Application
    Gère le daemon Nexus en arrière-plan, affiche l'état dans la barre des tâches (systray),
    permet d'ouvrir l'interface Web, de copier l'URL mobile et de démarrer avec Windows.
#>

[CmdletBinding()]
param()

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# 1. Empêcher les doublons (Instance unique)
$mutexName = "Global\NexusWindowsTrayMutex"
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)

if (-not $createdNew) {
    [System.Windows.Forms.MessageBox]::Show(
        "Nexus tourne déjà dans la barre des tâches (près de l'horloge Windows).",
        "Nexus Agent",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    )
    exit 0
}

# 2. Chemins et configuration
$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
}

$iconPath = Join-Path $scriptDir "nexus.ico"
$port = 4040
$healthUrl = "http://127.0.0.1:$port/health"

$startupShortcutPath = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)) "Nexus.lnk"
$vbsLauncherPath = Join-Path $scriptDir "Nexus.vbs"

# 3. Fonctions de contrôle du daemon via WSL
function Get-DaemonHealth {
    try {
        $req = [System.Net.WebRequest]::Create($healthUrl)
        $req.Timeout = 1200
        $req.Method = "GET"
        $resp = $req.GetResponse()
        $resp.Close()
        return $true
    } catch {
        return $false
    }
}

function Start-NexusDaemon {
    if (Get-DaemonHealth) {
        return
    }
    
    $wslScript = "export PATH=`$HOME/.nvm/versions/node/v24.14.1/bin:`$HOME/.local/bin:`$PATH; " +
                 "tmux kill-session -t nexus-daemon 2>/dev/null || true; " +
                 "tmux new-session -d -s nexus-daemon 'node /home/kaox/code/bricolage/nexus/dist/daemon.js --host 0.0.0.0 --port $port'"

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "wsl.exe"
    $psi.Arguments = "-e bash -l -c `"$wslScript`""
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.CreateNoWindow = $true
    $psi.UseShellExecute = $false

    try {
        $proc = [System.Diagnostics.Process]::Start($psi)
        $proc.WaitForExit(3000)
    } catch {
        # Si wsl.exe échoue
    }
}

function Stop-NexusDaemon {
    $wslScript = "tmux kill-session -t nexus-daemon 2>/dev/null || true; " +
                 "pkill -f 'dist/daemon.js' 2>/dev/null || true"

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "wsl.exe"
    $psi.Arguments = "-e bash -c `"$wslScript`""
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.CreateNoWindow = $true
    $psi.UseShellExecute = $false

    try {
        $proc = [System.Diagnostics.Process]::Start($psi)
        $proc.WaitForExit(3000)
    } catch {
    }
}

function Restart-NexusDaemon {
    Stop-NexusDaemon
    Start-Sleep -Milliseconds 800
    Start-NexusDaemon
}

function Get-LocalIpAddress {
    try {
        $ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
            $_.InterfaceAlias -notmatch "Loopback|vEthernet|WSL" -and
            $_.IPAddress -notmatch "^127\.|^169\.254\."
        }
        # Privilégier Tailscale (100.x.x.x) si disponible
        $tailscale = $ips | Where-Object { $_.IPAddress -match "^100\." } | Select-Object -First 1
        if ($tailscale) { return $tailscale.IPAddress }

        # Sinon IP LAN standard
        $lan = $ips | Where-Object { $_.IPAddress -match "^192\.168\.|^10\.|^172\." } | Select-Object -First 1
        if ($lan) { return $lan.IPAddress }
    } catch {}
    return "127.0.0.1"
}

function Test-StartupShortcut {
    return (Test-Path $startupShortcutPath)
}

function Toggle-StartupShortcut {
    if (Test-StartupShortcut) {
        Remove-Item -Path $startupShortcutPath -Force -ErrorAction SilentlyContinue
        return $false
    } else {
        $wsh = New-Object -ComObject WScript.Shell
        $shortcut = $wsh.CreateShortcut($startupShortcutPath)
        $shortcut.TargetPath = $vbsLauncherPath
        $shortcut.WorkingDirectory = $scriptDir
        $shortcut.IconLocation = "$iconPath,0"
        $shortcut.Description = "Nexus Agent - Démarrage automatique"
        $shortcut.Save()
        return $true
    }
}

# 4. Création de l'icône dans la zone de notification (NotifyIcon)
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon

if (Test-Path $iconPath) {
    $notifyIcon.Icon = New-Object System.Drawing.Icon($iconPath)
} else {
    $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}

$notifyIcon.Text = "Nexus Agent — Initialisation..."
$notifyIcon.Visible = $true

# 5. Création du menu contextuel (ContextMenuStrip)
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$headerItem = New-Object System.Windows.Forms.ToolStripMenuItem("Nexus Agent v1.0.0")
$headerItem.Enabled = $false
$font = New-Object System.Drawing.Font($headerItem.Font.FontFamily, $headerItem.Font.Size, [System.Drawing.FontStyle]::Bold)
$headerItem.Font = $font
[void]$contextMenu.Items.Add($headerItem)

$statusItem = New-Object System.Windows.Forms.ToolStripMenuItem("● En ligne (Port $port)")
$statusItem.Enabled = $false
[void]$contextMenu.Items.Add($statusItem)

[void]$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

# Action : Ouvrir Web
$openWebItem = New-Object System.Windows.Forms.ToolStripMenuItem("🌐 Ouvrir l'application Web")
$openWebItem.Add_Click({
    [System.Diagnostics.Process]::Start("http://localhost:$port")
})
[void]$contextMenu.Items.Add($openWebItem)

# Action : Copier l'URL mobile
$copyUrlItem = New-Object System.Windows.Forms.ToolStripMenuItem("📋 Copier l'URL mobile")
$copyUrlItem.Add_Click({
    $ip = Get-LocalIpAddress
    $url = "http://${ip}:$port"
    [System.Windows.Forms.Clipboard]::SetText($url)
    $notifyIcon.ShowBalloonTip(
        2000,
        "Nexus — URL copiée",
        "L'adresse mobile $url a été copiée dans votre presse-papier.",
        [System.Windows.Forms.ToolTipIcon]::Info
    )
})
[void]$contextMenu.Items.Add($copyUrlItem)

[void]$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

# Action : Redémarrer le démon
$restartItem = New-Object System.Windows.Forms.ToolStripMenuItem("🔄 Redémarrer le démon")
$restartItem.Add_Click({
    $notifyIcon.Text = "Nexus Agent — Redémarrage en cours..."
    $statusItem.Text = "○ Redémarrage..."
    Restart-NexusDaemon
    Start-Sleep -Seconds 1
    Update-Status
})
[void]$contextMenu.Items.Add($restartItem)

# Action : Arrêter / Démarrer
$toggleDaemonItem = New-Object System.Windows.Forms.ToolStripMenuItem("⏹ Arrêter le démon")
$toggleDaemonItem.Add_Click({
    if (Get-DaemonHealth) {
        Stop-NexusDaemon
    } else {
        Start-NexusDaemon
    }
    Start-Sleep -Milliseconds 800
    Update-Status
})
[void]$contextMenu.Items.Add($toggleDaemonItem)

[void]$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

# Option : Démarrage avec Windows
$startupItem = New-Object System.Windows.Forms.ToolStripMenuItem("🚀 Démarrer avec Windows")
$startupItem.Checked = Test-StartupShortcut
$startupItem.Add_Click({
    $isNowEnabled = Toggle-StartupShortcut
    $startupItem.Checked = $isNowEnabled
    if ($isNowEnabled) {
        $notifyIcon.ShowBalloonTip(2000, "Nexus", "Démarrage automatique avec Windows activé.", [System.Windows.Forms.ToolTipIcon]::Info)
    } else {
        $notifyIcon.ShowBalloonTip(2000, "Nexus", "Démarrage automatique désactivé.", [System.Windows.Forms.ToolTipIcon]::Info)
    }
})
[void]$contextMenu.Items.Add($startupItem)

[void]$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

# Action : Quitter
$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem("❌ Quitter Nexus")
$exitItem.Add_Click({
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    Stop-NexusDaemon
    [System.Windows.Forms.Application]::Exit()
})
[void]$contextMenu.Items.Add($exitItem)

$notifyIcon.ContextMenuStrip = $contextMenu

# Double-clic sur l'icône -> ouvre le Web
$notifyIcon.Add_DoubleClick({
    [System.Diagnostics.Process]::Start("http://localhost:$port")
})

# 6. Fonction de rafraîchissement d'état
function Update-Status {
    $isUp = Get-DaemonHealth
    $ip = Get-LocalIpAddress
    if ($isUp) {
        $notifyIcon.Text = "Nexus Agent — En ligne ($ip:$port)"
        $statusItem.Text = "● En ligne (Port $port)"
        $statusItem.ForeColor = [System.Drawing.Color]::Green
        $toggleDaemonItem.Text = "⏹ Arrêter le démon"
        $openWebItem.Enabled = $true
    } else {
        $notifyIcon.Text = "Nexus Agent — Démon arrêté"
        $statusItem.Text = "○ Démon arrêté"
        $statusItem.ForeColor = [System.Drawing.Color]::Gray
        $toggleDaemonItem.Text = "▶ Démarrer le démon"
        $openWebItem.Enabled = $false
    }
}

# 7. Démarrage automatique du daemon au lancement si nécessaire
Start-NexusDaemon

# Timer pour surveiller la santé toutes les 4 secondes
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 4000
$timer.Add_Tick({
    Update-Status
})
$timer.Start()

Update-Status

$notifyIcon.ShowBalloonTip(
    3000,
    "Nexus Agent Actif",
    "Nexus tourne en arrière-plan. Accessible sur le port $port ou via l'application mobile.",
    [System.Windows.Forms.ToolTipIcon]::Info
)

# 8. Boucle de messages Windows
try {
    [System.Windows.Forms.Application]::Run()
} finally {
    $timer.Stop()
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    if ($mutex) {
        $mutex.ReleaseMutex()
        $mutex.Dispose()
    }
}
