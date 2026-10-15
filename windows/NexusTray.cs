using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

namespace NexusTrayApp
{
    static class Program
    {
        private const int Port = 4040;
        private const string HealthUrl = "http://127.0.0.1:4040/health";
        private const string MutexName = "NexusWindowsTrayAppMutex";
        private const string NodePath = "/home/kaox/.nvm/versions/node/v24.14.1/bin/node";
        private const string DaemonJs = "/home/kaox/code/bricolage/nexus/dist/daemon.js";

        private static NotifyIcon notifyIcon;
        private static ContextMenuStrip contextMenu;
        private static ToolStripMenuItem statusItem;
        private static ToolStripMenuItem toggleDaemonItem;
        private static ToolStripMenuItem openWebItem;
        private static ToolStripMenuItem startupItem;
        private static System.Windows.Forms.Timer healthTimer;
        private static Mutex singleInstanceMutex;
        private static string appDir;
        private static string startupShortcutPath;

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool createdNew;
            singleInstanceMutex = new Mutex(true, MutexName, out createdNew);
            if (!createdNew)
            {
                MessageBox.Show(
                    "Nexus tourne déjà dans la barre des tâches (près de l'horloge Windows).\nVérifiez la zone de notification ou la flèche ^.",
                    "Nexus Agent",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
                return;
            }

            appDir = AppDomain.CurrentDomain.BaseDirectory;
            startupShortcutPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Startup),
                "Nexus.lnk"
            );

            // Création de l'icône de notification
            notifyIcon = new NotifyIcon();
            string iconPath = Path.Combine(appDir, "nexus.ico");
            if (File.Exists(iconPath))
            {
                try
                {
                    notifyIcon.Icon = new Icon(iconPath);
                }
                catch
                {
                    notifyIcon.Icon = SystemIcons.Application;
                }
            }
            else
            {
                notifyIcon.Icon = SystemIcons.Application;
            }

            notifyIcon.Text = "Nexus Agent - En ligne";
            notifyIcon.Visible = true;
            notifyIcon.DoubleClick += (s, e) => OpenWebClient();

            // Création du Menu Contextuel
            contextMenu = new ContextMenuStrip();

            var headerItem = new ToolStripMenuItem("Nexus Agent v1.0.0");
            headerItem.Enabled = false;
            headerItem.Font = new Font(headerItem.Font, FontStyle.Bold);
            contextMenu.Items.Add(headerItem);

            statusItem = new ToolStripMenuItem("[En ligne] Port " + Port);
            statusItem.Enabled = false;
            contextMenu.Items.Add(statusItem);

            contextMenu.Items.Add(new ToolStripSeparator());

            openWebItem = new ToolStripMenuItem("Ouvrir l'application Web", null, (s, e) => OpenWebClient());
            contextMenu.Items.Add(openWebItem);

            var copyUrlItem = new ToolStripMenuItem("Copier l'URL mobile", null, (s, e) => CopyMobileUrl());
            contextMenu.Items.Add(copyUrlItem);

            contextMenu.Items.Add(new ToolStripSeparator());

            var restartItem = new ToolStripMenuItem("Redémarrer le démon", null, (s, e) => RestartDaemon());
            contextMenu.Items.Add(restartItem);

            toggleDaemonItem = new ToolStripMenuItem("Arrêter le démon", null, (s, e) => ToggleDaemon());
            contextMenu.Items.Add(toggleDaemonItem);

            contextMenu.Items.Add(new ToolStripSeparator());

            startupItem = new ToolStripMenuItem("Démarrer avec Windows", null, (s, e) => ToggleStartup());
            startupItem.Checked = File.Exists(startupShortcutPath);
            contextMenu.Items.Add(startupItem);

            contextMenu.Items.Add(new ToolStripSeparator());

            var exitItem = new ToolStripMenuItem("Quitter Nexus", null, (s, e) => ExitApplication());
            contextMenu.Items.Add(exitItem);

            notifyIcon.ContextMenuStrip = contextMenu;

            // Démarrage du daemon si besoin
            StartDaemon();

            // Timer de surveillance
            healthTimer = new System.Windows.Forms.Timer();
            healthTimer.Interval = 4000;
            healthTimer.Tick += (s, e) => UpdateStatus();
            healthTimer.Start();

            UpdateStatus();

            try
            {
                notifyIcon.ShowBalloonTip(
                    3000,
                    "Nexus Agent Actif",
                    "Nexus tourne en arrière-plan sur le port " + Port + ".\nAccessible sur le web ou votre smartphone.",
                    ToolTipIcon.Info
                );
            }
            catch { }

            Application.Run();
        }

        private static bool CheckDaemonHealth()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(HealthUrl);
                req.Timeout = 1200;
                req.Method = "GET";
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void StartDaemon()
        {
            if (CheckDaemonHealth()) return;

            string wslCmd = "tmux kill-session -t nexus-daemon 2>/dev/null || true; " +
                           "tmux new-session -d -s nexus-daemon '" + NodePath + " " + DaemonJs + " --host 0.0.0.0 --port " + Port + "'";

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "wsl.exe";
            psi.Arguments = "-e bash -l -c \"" + wslCmd + "\"";
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;

            try
            {
                Process proc = Process.Start(psi);
                if (proc != null) proc.WaitForExit(3000);
            }
            catch { }
        }

        private static void StopDaemon()
        {
            string wslCmd = "tmux kill-session -t nexus-daemon 2>/dev/null || true; pkill -f 'dist/daemon.js' 2>/dev/null || true";

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "wsl.exe";
            psi.Arguments = "-e bash -c \"" + wslCmd + "\"";
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;

            try
            {
                Process proc = Process.Start(psi);
                if (proc != null) proc.WaitForExit(3000);
            }
            catch { }
        }

        private static void RestartDaemon()
        {
            notifyIcon.Text = "Nexus Agent - Redémarrage...";
            statusItem.Text = "[...] Redémarrage...";
            StopDaemon();
            Thread.Sleep(800);
            StartDaemon();
            Thread.Sleep(1000);
            UpdateStatus();
        }

        private static void ToggleDaemon()
        {
            if (CheckDaemonHealth())
            {
                StopDaemon();
            }
            else
            {
                StartDaemon();
            }
            Thread.Sleep(800);
            UpdateStatus();
        }

        private static void OpenWebClient()
        {
            try
            {
                Process.Start("http://localhost:" + Port);
            }
            catch { }
        }

        private static string GetLocalIp()
        {
            try
            {
                string bestIp = "127.0.0.1";
                var host = Dns.GetHostEntry(Dns.GetHostName());
                foreach (var ip in host.AddressList)
                {
                    if (ip.AddressFamily == AddressFamily.InterNetwork)
                    {
                        string str = ip.ToString();
                        if (str.StartsWith("100.")) return str; // Tailscale
                        if (str.StartsWith("192.168.") || str.StartsWith("10.")) bestIp = str;
                    }
                }
                return bestIp;
            }
            catch
            {
                return "127.0.0.1";
            }
        }

        private static void CopyMobileUrl()
        {
            string ip = GetLocalIp();
            string url = "http://" + ip + ":" + Port;
            try
            {
                Clipboard.SetText(url);
                notifyIcon.ShowBalloonTip(
                    2000,
                    "Nexus - URL copiée",
                    "L'adresse mobile " + url + " a été copiée dans le presse-papier.",
                    ToolTipIcon.Info
                );
            }
            catch { }
        }

        private static void ToggleStartup()
        {
            try
            {
                if (File.Exists(startupShortcutPath))
                {
                    File.Delete(startupShortcutPath);
                    startupItem.Checked = false;
                    notifyIcon.ShowBalloonTip(2000, "Nexus", "Démarrage automatique désactivé.", ToolTipIcon.Info);
                }
                else
                {
                    string exePath = Application.ExecutablePath;
                    Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                    dynamic shell = Activator.CreateInstance(shellType);
                    dynamic shortcut = shell.CreateShortcut(startupShortcutPath);
                    shortcut.TargetPath = exePath;
                    shortcut.WorkingDirectory = appDir;
                    shortcut.Description = "Nexus Agent - Démarrage automatique";
                    shortcut.Save();

                    startupItem.Checked = true;
                    notifyIcon.ShowBalloonTip(2000, "Nexus", "Démarrage automatique avec Windows activé.", ToolTipIcon.Info);
                }
            }
            catch { }
        }

        private static void UpdateStatus()
        {
            bool isUp = CheckDaemonHealth();
            if (isUp)
            {
                notifyIcon.Text = "Nexus Agent - En ligne";
                statusItem.Text = "[OK] En ligne (Port " + Port + ")";
                statusItem.ForeColor = Color.Green;
                toggleDaemonItem.Text = "Arrêter le démon";
                openWebItem.Enabled = true;
            }
            else
            {
                notifyIcon.Text = "Nexus Agent - Arrêté";
                statusItem.Text = "[OFF] Démon arrêté";
                statusItem.ForeColor = Color.Gray;
                toggleDaemonItem.Text = "Démarrer le démon";
                openWebItem.Enabled = false;
            }
        }

        private static void ExitApplication()
        {
            if (healthTimer != null) healthTimer.Stop();
            if (notifyIcon != null)
            {
                notifyIcon.Visible = false;
                notifyIcon.Dispose();
            }
            StopDaemon();
            if (singleInstanceMutex != null)
            {
                try { singleInstanceMutex.ReleaseMutex(); } catch { }
                singleInstanceMutex.Dispose();
            }
            Application.Exit();
        }
    }
}
