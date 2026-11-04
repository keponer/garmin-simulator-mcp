using System;
using System.Windows.Forms;

public class SimulatorFixture : Form {
    readonly string mode;
    public SimulatorFixture(string mode) {
        this.mode = mode;
        Text = "Simulator test fixture";
        Width = 420;
        Height = 260;
        if (mode == "maximized") WindowState = FormWindowState.Maximized;
        if (mode == "minimized") WindowState = FormWindowState.Minimized;
    }
    protected override void OnShown(EventArgs e) {
        base.OnShown(e);
        if (mode != "editor" && mode != "hold-editor" && mode != "modal-editor") return;
        var editor = new Form { Text = "Modify Object Store", Width = 300, Height = 160 };
        var cancel = new Button { Text = "Cancel" };
        cancel.Click += delegate { if (mode != "hold-editor") editor.Close(); };
        editor.Controls.Add(cancel);
        if (mode == "modal-editor") editor.ShowDialog(this);
        else editor.Show(this);
    }
    [STAThread]
    public static void Main(string[] args) {
        Application.Run(new SimulatorFixture(args.Length > 0 ? args[0] : "normal"));
    }
}
