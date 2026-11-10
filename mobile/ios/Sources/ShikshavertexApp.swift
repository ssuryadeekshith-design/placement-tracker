import SwiftUI

@main
struct ShikshavertexApp: App {
    var body: some Scene { WindowGroup { Workspace().ignoresSafeArea(edges: .bottom) } }
}

private struct Workspace: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WorkspaceController { WorkspaceController() }
    func updateUIViewController(_ controller: WorkspaceController, context: Context) {}
}
