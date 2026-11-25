// Collaboration groups on the phone (PRD v1.243, Figma 111′A–D): the sessions a main conversation dispatched, its
// subagents, teammates and workflow runs fold into one row under it — a chevron, `N 个成员` and a glyph with a count per
// status, all counted on the Mac — and one tap opens the members one level. Shared by 会话 and 看板 · 进度; which folds
// are open is kept on this phone (FoldOpen).
import SwiftUI

/// The fold row (44 pt): chevron · `N 个成员` · the status counts. `onCard`: inside a board card, the card's quieter text.
struct MemberFoldRow: View {
  let group: RemoteGroup
  let open: Bool
  var leading: CGFloat = Metric.margin
  var trailing: CGFloat = Metric.margin
  let toggle: () -> Void

  var body: some View {
    Button(action: toggle) {
      HStack(spacing: 8) {
        Icon(open ? "chevron-down" : "chevron-right", size: 14).foregroundStyle(Color.textSecondary).frame(width: 14)
        Text("\(group.total) 个成员").font(.ui(.subheadline)).foregroundStyle(Color.textSecondary)
        ForEach(Array(group.counts.enumerated()), id: \.offset) { _, count in
          HStack(spacing: 4) {
            StatusGlyph(status: count.status)
            Text("\(count.count)").font(.ui(.subheadline)).monospacedDigit().foregroundStyle(Color.textSecondary)
          }
          .accessibilityElement(children: .combine)
          .accessibilityLabel("\(count.status.label) \(count.count)")
        }
        Spacer(minLength: 0)
      }
      .padding(.leading, leading)
      .padding(.trailing, trailing)
      .frame(minHeight: Metric.touch)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityHint(open ? "收起成员" : "展开成员")
  }
}

/// One member line: glyph · title, and on the right the time of a session (tappable, a chevron after it) or the model /
/// phase of the others (plain text).
struct MemberLine: View {
  let item: FoldMember
  let now: Double
  var leading: CGFloat
  var trailing: CGFloat = Metric.margin
  /// Inside a card: the card's quieter line colour.
  var tone: CardTone?

  var body: some View {
    HStack(spacing: 12) {
      StatusGlyph(status: item.member.status)
      Text(item.member.title).font(.ui(.subheadline)).foregroundStyle(Color.textPrimary).lineLimit(1)
      Spacer(minLength: 8)
      if let session = item.session {
        Text(rowTime(session, now: now)).font(.ui(.footnote)).monospacedDigit().foregroundStyle(meta)
        Icon("chevron-right", size: 14).foregroundStyle(meta)
      } else if let text = item.member.meta {
        Text(text).font(.ui(.footnote)).foregroundStyle(meta).lineLimit(1)
      }
    }
    .padding(.leading, leading)
    .padding(.trailing, trailing)
    .frame(minHeight: Metric.touch)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }

  private var meta: Color { tone.map(Color.cardMeta) ?? .textSecondary }
}

/// The members under a session in 会话: the fold row, and open, one level of members; a session member with a group of its
/// own gets its fold row one step in. Folds nest no deeper than the Mac's two dispatch levels.
struct FoldList: View {
  let session: RemoteSession
  let list: RemoteSessionList
  let now: Double
  let open: Set<String>
  var depth = 0
  let toggle: (String) -> Void

  var body: some View {
    if let group = session.group, depth < 3 {
      MemberFoldRow(group: group, open: open.contains(session.id), leading: Metric.margin + 26 * CGFloat(depth + 1)) { toggle(session.id) }
      if open.contains(session.id) {
        ForEach(foldMembers(of: session, in: list)) { item in
          let leading = Metric.margin + 26 * CGFloat(depth + 1)
          if let child = item.session {
            NavigationLink(value: Route.session(child.id)) { MemberLine(item: item, now: now, leading: leading) }
              .buttonStyle(RowStyle())
            FoldList(session: child, list: list, now: now, open: open, depth: depth + 1, toggle: toggle)
          } else {
            MemberLine(item: item, now: now, leading: leading)
          }
        }
      }
    }
  }
}


/// A board card's open fold (Figma 111′D): the members and, under a session member, its own members — two levels, flat and
/// indented, with no fold row of their own. A session member opens that session.
struct CardMembers: View {
  let session: RemoteSession
  let list: RemoteSessionList
  let now: Double
  let tone: CardTone
  var depth = 0

  var body: some View {
    if depth < 2 {
      ForEach(foldMembers(of: session, in: list)) { item in
        let leading = 26 * CGFloat(depth)
        if let child = item.session {
          NavigationLink(value: Route.session(child.id)) { MemberLine(item: item, now: now, leading: leading, trailing: 0, tone: tone) }
            .buttonStyle(.plain)
          CardMembers(session: child, list: list, now: now, tone: tone, depth: depth + 1)
        } else {
          MemberLine(item: item, now: now, leading: leading, trailing: 0, tone: tone)
        }
      }
    }
  }
}
